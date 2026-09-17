import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getGoogleOAuthClient,
  readCookie,
  sessionCookie,
  clearOAuthStateCookie,
  clearSessionCookie,
  getDriveSession,
} from '../../../server/google-oauth';
import { getSql } from '../../../server/db';

async function status(request: VercelRequest, response: VercelResponse) {
  try {
    const session = await getDriveSession(request);
    return response.status(200).json({ data: { connected: Boolean(session), email: session?.google_email ?? null }, meta: {}, errors: [] });
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

async function callback(request: VercelRequest, response: VercelResponse) {
  try {
    const stateCookie = readCookie(request, 'oauth_state');
    const state = typeof request.query.state === 'string' ? request.query.state : '';
    if (!stateCookie || stateCookie !== state) {
      return response.status(400).send('Estado OAuth inválido.');
    }

    const code = typeof request.query.code === 'string' ? request.query.code : '';
    if (!code) return response.status(400).send('Google no devolvió un código OAuth.');

    const client = getGoogleOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userResponse.json();
    if (!user.email) return response.status(400).send('No se pudo identificar la cuenta Google.');

    const sessionId = crypto.randomUUID();
    const sql = await getSql();
    await sql`
      INSERT INTO google_drive_sessions (session_id, google_email, token_json, expires_at)
      VALUES (${sessionId}, ${user.email}, ${JSON.stringify(tokens)}, NOW() + INTERVAL '30 days')
    `;
    response.setHeader('Set-Cookie', [sessionCookie(sessionId), clearOAuthStateCookie()]);
    return response.redirect(302, '/?drive=connected');
  } catch (error) {
    console.error('Google OAuth callback failed', error);
    return response.status(500).send('No fue posible completar la conexión con Google Drive.');
  }
}

export default function handler(request: VercelRequest, response: VercelResponse) {
  const action = typeof request.query.action === 'string' ? request.query.action : '';
  switch (action) {
    case 'status':
      return status(request, response);
    case 'logout':
      return logout(request, response);
    case 'callback':
      return callback(request, response);
    default:
      return response.status(404).json({ data: null, meta: {}, errors: ['Ruta no encontrada.'] });
  }
}
