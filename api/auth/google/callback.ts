import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGoogleOAuthClient, readCookie, sessionCookie, clearOAuthStateCookie } from '../../../server/google-oauth';
import { getSql } from '../../../server/db';

export default async function handler(request: VercelRequest, response: VercelResponse) {
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