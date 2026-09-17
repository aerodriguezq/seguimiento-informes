import { getSql } from './db';

export const driveScope = 'https://www.googleapis.com/auth/drive';

export async function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o GOOGLE_REDIRECT_URI.');
  }

  const { OAuth2Client } = await import('google-auth-library');
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

export function readCookie(request: { headers: { cookie?: string } }, name: string) {
  const cookies = request.headers.cookie?.split(';').map((cookie) => cookie.trim()) ?? [];
  const entry = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

export async function getDriveSession(request: { headers: { cookie?: string } }) {
  const sql = await getSql();
  const sessionId = readCookie(request, 'drive_session');
  if (!sessionId) return null;

  const rows = await sql`
    SELECT session_id, google_email, token_json, expires_at
    FROM google_drive_sessions
    WHERE session_id = ${sessionId} AND expires_at > NOW()
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export function sessionCookie(value: string, maxAge = 60 * 60 * 24 * 30, name = 'drive_session') {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return sessionCookie('', 0);
}

export function clearOAuthStateCookie() {
  return sessionCookie('', 0, 'oauth_state');
}