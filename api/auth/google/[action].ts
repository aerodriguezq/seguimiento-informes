import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sign as edSign, createPrivateKey } from 'node:crypto';
import {
  getGoogleOAuthClient,
  readCookie,
  sessionCookie,
  clearOAuthStateCookie,
  clearSessionCookie,
} from '../../../server/google-oauth.js';
import { getSql } from '../../../server/db.js';
import { withApiMetrics } from '../../../server/metrics.js';

function base64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input) : input).toString('base64url');
}

// Ojo: esto NO mira la cookie drive_session de quien pregunta -- mira si la
// conexión COMPARTIDA por toda la app (la que usa getConnectedAccessToken
// en api/reports.ts, api/alerts, api/catalogs, api/projects) está sana.
// Antes miraba la cookie del navegador, lo que daba "no conectado" en un
// equipo nuevo aunque otro admin ya hubiera conectado la cuenta desde el
// suyo -- y es el chequeo que necesita el auto-reconectar al iniciar
// sesión (AuthContext.tsx), que no tiene ninguna cookie de Drive propia.
async function status(request: VercelRequest, response: VercelResponse) {
  try {
    const sql = await getSql();
    const [row] = await sql`
      SELECT google_email FROM google_drive_sessions
      WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1
    `;
    return response.status(200).json({ data: { connected: Boolean(row), email: row?.google_email ?? null }, meta: {}, errors: [] });
  } catch (error) {
    console.error('Google OAuth status failed', error);
    return response.status(503).json({ data: null, meta: {}, errors: ['No fue posible consultar la conexión Google.'] });
  }
}

async function logout(request: VercelRequest, response: VercelResponse) {
  const sessionId = readCookie(request, 'drive_session');
  if (sessionId) {
    const sql = await getSql();
    await sql`DELETE FROM google_drive_sessions WHERE session_id = ${sessionId}`;
  }
  response.setHeader('Set-Cookie', clearSessionCookie());
  return response.status(200).json({ data: { connected: false }, meta: {}, errors: [] });
}

// Login general de la app (distinto de "Conectar Google Drive"): reutiliza
// el mismo cliente OAuth y la misma URI de redirección ya autorizada en
// Google Cloud, pidiendo solo identidad (sin scopes de Drive/Gmail). El
// estado codifica "app:" para que el callback sepa que es este flujo y no
// el de conectar Drive.
async function appLoginStart(request: VercelRequest, response: VercelResponse) {
  try {
    const client = await getGoogleOAuthClient();
    const state = `app:${crypto.randomUUID()}`;
    response.setHeader('Set-Cookie', sessionCookie(state, 600, 'oauth_state'));
    const url = client.generateAuthUrl({
      access_type: 'online',
      prompt: 'select_account',
      scope: ['openid', 'email', 'profile'],
      state,
    });
    return response.redirect(302, url);
  } catch (error) {
    console.error('App login start failed', error);
    return response.status(503).json({ data: null, meta: {}, errors: ['OAuth de Google no está configurado.'] });
  }
}

async function appStatus(request: VercelRequest, response: VercelResponse) {
  try {
    const sessionId = readCookie(request, 'app_session');
    if (!sessionId) return response.status(200).json({ data: null, meta: {}, errors: [] });

    const sql = await getSql();
    const [row] = await sql`
      SELECT u.email, u.nombre AS name, u.es_admin AS "isAdmin", u.permisos AS permissions
      FROM app_sesiones s
      JOIN usuarios_autorizados u ON u.email = s.email
      WHERE s.session_id = ${sessionId} AND s.expires_at > NOW() AND u.activo = TRUE
    `;
    return response.status(200).json({ data: row || null, meta: {}, errors: [] });
  } catch (error) {
    console.error('App status failed', error);
    return response.status(503).json({ data: null, meta: {}, errors: ['No fue posible consultar la sesión.'] });
  }
}

async function appLogout(request: VercelRequest, response: VercelResponse) {
  const sessionId = readCookie(request, 'app_session');
  if (sessionId) {
    const sql = await getSql();
    await sql`DELETE FROM app_sesiones WHERE session_id = ${sessionId}`;
  }
  response.setHeader('Set-Cookie', sessionCookie('', 0, 'app_session'));
  return response.status(200).json({ data: null, meta: {}, errors: [] });
}

// Permitidos EXACTOS como prefijo de "return" -- cualquier otro valor se
// rechaza con 400. Sin esta lista, "return" sería una redirección abierta
// (open redirect): cualquiera podría mandar a alguien autenticado aquí a
// "https://informes-egdn.vercel.app/api/auth/google/sso-geocampo?return=https://sitio-malicioso.com/#sso=<jwt>"
// y quedarse con un JWT válido de esa persona.
const SSO_GEOCAMPO_ALLOWED_RETURN_PREFIXES = [
  'https://geocampo-egdn.vercel.app/panel/',
  'https://geocampo-69fy.vercel.app/panel/',
];
const SSO_GEOCAMPO_DEFAULT_RETURN = SSO_GEOCAMPO_ALLOWED_RETURN_PREFIXES[0];
const SSO_GEOCAMPO_POST_LOGIN_PATH = '/api/auth/google/sso-geocampo';

// Puente de sesión hacia Geo-Campo (sistema externo, otro proyecto en
// Vercel): si ya hay sesión de Seguimiento, firma un JWT corto (EdDSA /
// Ed25519) con el correo autorizado y redirige a Geo-Campo con el JWT en el
// FRAGMENTO de la URL (después de "#"), nunca en la query -- el fragmento
// nunca viaja al servidor ni queda en logs de acceso. Si no hay sesión,
// manda a loguearse aquí primero (reutilizando el mismo flujo OAuth de
// app-login-start) y usa una cookie corta para recordar que hay que volver
// a este mismo endpoint una vez vuelva del login.
async function ssoGeoCampo(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');

  const rawReturn = typeof request.query.return === 'string' ? request.query.return : '';
  const returnUrl = rawReturn || SSO_GEOCAMPO_DEFAULT_RETURN;
  if (!SSO_GEOCAMPO_ALLOWED_RETURN_PREFIXES.some((prefix) => returnUrl.startsWith(prefix))) {
    return response.status(400).send('El parámetro "return" no está permitido.');
  }

  try {
    const sql = await getSql();
    const sessionId = readCookie(request, 'app_session');
    const [authorizedUser] = sessionId
      ? ((await sql`
          SELECT u.email, u.nombre AS name
          FROM app_sesiones s
          JOIN usuarios_autorizados u ON u.email = s.email
          WHERE s.session_id = ${sessionId} AND s.expires_at > NOW() AND u.activo = TRUE
        `) as any[])
      : [];

    if (!authorizedUser) {
      // Mismo flujo que appLoginStart, pero agregando la cookie post_login
      // (corta, HttpOnly) para que el callback sepa a dónde volver -- sin
      // reusar appLoginStart tal cual porque esta además necesita fijar esa
      // segunda cookie en la misma respuesta.
      const client = await getGoogleOAuthClient();
      const state = `app:${crypto.randomUUID()}`;
      const postLoginTarget = `${SSO_GEOCAMPO_POST_LOGIN_PATH}?return=${encodeURIComponent(returnUrl)}`;
      response.setHeader('Set-Cookie', [
        sessionCookie(state, 600, 'oauth_state'),
        sessionCookie(postLoginTarget, 600, 'post_login'),
      ]);
      const url = client.generateAuthUrl({
        access_type: 'online',
        prompt: 'select_account',
        scope: ['openid', 'email', 'profile'],
        state,
      });
      return response.redirect(302, url);
    }

    const privateKeyPem = process.env.SSO_PRIVATE_KEY;
    if (!privateKeyPem) {
      return response.status(503).send('El inicio de sesión con Geo-Campo no está configurado.');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = { alg: 'EdDSA', typ: 'JWT' };
    const payload = {
      iss: 'https://informes-egdn.vercel.app',
      aud: 'geocampo',
      sub: String(authorizedUser.email).trim().toLowerCase(),
      name: authorizedUser.name,
      iat: nowSeconds,
      exp: nowSeconds + 60,
      jti: crypto.randomUUID(),
    };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const signature = edSign(null, Buffer.from(signingInput), createPrivateKey(privateKeyPem));
    const jwt = `${signingInput}.${base64url(signature)}`;

    return response.redirect(302, `${returnUrl}#sso=${jwt}`);
  } catch (error) {
    console.error('SSO Geo-Campo failed', error);
    return response.status(500).send('No fue posible iniciar sesión en Geo-Campo.');
  }
}

async function callback(request: VercelRequest, response: VercelResponse) {
  try {
    const stateCookie = readCookie(request, 'oauth_state');
    const state = typeof request.query.state === 'string' ? request.query.state : '';
    if (!stateCookie || stateCookie !== state) {
      return response.status(400).send('Estado OAuth inválido.');
    }

    const code = typeof request.query.code === 'string' ? request.query.code : '';
    if (!code) return response.status(400).send('Google no devolvió un código OAuth.');

    const client = await getGoogleOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userResponse.json();
    if (!user.email) return response.status(400).send('No se pudo identificar la cuenta Google.');
    // Los correos se guardan en minúsculas en toda la app (usuarios_autorizados,
    // app_sesiones); Google a veces devuelve el correo con mayúsculas tal como
    // esté configurado en la cuenta, y una comparación exacta sin normalizar
    // rechaza a un usuario correctamente autorizado.
    const normalizedEmail = String(user.email).trim().toLowerCase();

    const sql = await getSql();

    if (state.startsWith('app:')) {
      const [authorizedUser] = await sql`
        SELECT email FROM usuarios_autorizados WHERE email = ${normalizedEmail} AND activo = TRUE
      `;
      if (!authorizedUser) {
        response.setHeader('Set-Cookie', clearOAuthStateCookie());
        return response.redirect(302, '/?login=unauthorized');
      }

      const sessionId = crypto.randomUUID();
      await sql`
        INSERT INTO app_sesiones (session_id, email, expires_at)
        VALUES (${sessionId}, ${normalizedEmail}, NOW() + INTERVAL '30 days')
      `;
      const cookiesToSet = [sessionCookie(sessionId, 60 * 60 * 24 * 30, 'app_session'), clearOAuthStateCookie()];

      // Si este login vino de ssoGeoCampo (sin sesión, mandó a loguearse
      // antes de poder firmar el JWT), post_login guarda a dónde volver.
      // Solo se sigue si apunta a nuestra propia ruta SSO -- la pusimos
      // nosotros mismos, pero no hay razón para seguir ninguna otra cosa.
      const postLogin = readCookie(request, 'post_login');
      if (postLogin && postLogin.startsWith('/api/auth/google/sso-geocampo')) {
        cookiesToSet.push(sessionCookie('', 0, 'post_login'));
        response.setHeader('Set-Cookie', cookiesToSet);
        return response.redirect(302, postLogin);
      }

      response.setHeader('Set-Cookie', cookiesToSet);
      return response.redirect(302, '/');
    }

    const sessionId = crypto.randomUUID();
    await sql`
      INSERT INTO google_drive_sessions (session_id, google_email, token_json, expires_at)
      VALUES (${sessionId}, ${user.email}, ${JSON.stringify(tokens)}, NOW() + INTERVAL '30 days')
    `;
    response.setHeader('Set-Cookie', [sessionCookie(sessionId), clearOAuthStateCookie()]);
    return response.redirect(302, '/?drive=connected');
  } catch (error) {
    console.error('Google OAuth callback failed', error);
    return response.status(500).send('No fue posible completar la conexión con Google.');
  }
}

function handler(request: VercelRequest, response: VercelResponse) {
  const action = typeof request.query.action === 'string' ? request.query.action : '';
  switch (action) {
    case 'status':
      return status(request, response);
    case 'logout':
      return logout(request, response);
    case 'callback':
      return callback(request, response);
    case 'app-login-start':
      return appLoginStart(request, response);
    case 'app-status':
      return appStatus(request, response);
    case 'app-logout':
      return appLogout(request, response);
    case 'sso-geocampo':
      return ssoGeoCampo(request, response);
    default:
      return response.status(404).json({ data: null, meta: {}, errors: ['Ruta no encontrada.'] });
  }
}

export default withApiMetrics(
  (request) => `auth-google-${typeof request.query.action === 'string' ? request.query.action : 'unknown'}`,
  handler,
);
