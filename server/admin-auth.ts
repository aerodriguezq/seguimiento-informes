import { readCookie } from './google-oauth.js';

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

export async function isAdminRequest(request: { headers: { cookie?: string } }, sql: SqlClient): Promise<boolean> {
  const sessionId = readCookie(request, 'app_session');
  if (!sessionId) return false;
  const [row] = (await sql`
    SELECT u.es_admin AS "isAdmin"
    FROM app_sesiones s
    JOIN usuarios_autorizados u ON u.email = s.email
    WHERE s.session_id = ${sessionId} AND s.expires_at > NOW() AND u.activo = TRUE
  `) as any[];
  return Boolean(row?.isAdmin);
}

// Admin siempre puede; si no, revisa si esta persona tiene permiso "edit"
// explícito para ese módulo (permisos es un JSONB tipo {"seguimiento": "edit"}).
export async function canEditModuleRequest(
  request: { headers: { cookie?: string } },
  sql: SqlClient,
  moduleKey: string,
): Promise<boolean> {
  const sessionId = readCookie(request, 'app_session');
  if (!sessionId) return false;
  const [row] = (await sql`
    SELECT u.es_admin AS "isAdmin", u.permisos AS permissions
    FROM app_sesiones s
    JOIN usuarios_autorizados u ON u.email = s.email
    WHERE s.session_id = ${sessionId} AND s.expires_at > NOW() AND u.activo = TRUE
  `) as any[];
  if (!row) return false;
  if (row.isAdmin) return true;
  return (row.permissions ?? {})[moduleKey] === 'edit';
}
