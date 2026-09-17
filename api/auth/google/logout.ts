import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearSessionCookie, readCookie } from '../../../server/google-oauth';
import { getSql } from '../../../server/db';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const sessionId = readCookie(request, 'drive_session');
  if (sessionId) {
    const sql = await getSql();
    await sql`DELETE FROM google_drive_sessions WHERE session_id = ${sessionId}`;
  }
  response.setHeader('Set-Cookie', clearSessionCookie());
  return response.status(200).json({ data: { connected: false }, meta: {}, errors: [] });
}