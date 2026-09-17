import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGoogleOAuthClient, driveScope, sessionCookie } from '../../server/google-oauth.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const client = await getGoogleOAuthClient();
    const state = crypto.randomUUID();
    response.setHeader('Set-Cookie', sessionCookie(state, 600, 'oauth_state'));
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [driveScope, 'openid', 'email'],
      state,
    });
    return response.redirect(302, url);
  } catch (error) {
    console.error('Google OAuth start failed', error);
    return response.status(503).json({ data: null, meta: {}, errors: ['OAuth de Google no está configurado.'] });
  }
}