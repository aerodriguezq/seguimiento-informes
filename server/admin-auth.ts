import { readCookie } from './google-oauth.js';

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

// Mismo mapa que MODULE_DEFAULT_LEVEL en src/auth/AuthContext.tsx -- se
// duplica acá (no se importa desde src/, que es código de frontend) porque
// el backend necesita el mismo default por módulo para no quedar más
// permisivo que lo que el usuario ve habilitado en el sidebar. Todo módulo
// nuevo debe agregarse aquí en 'none', igual que allá.
const MODULE_DEFAULT_LEVEL: Record<string, 'none' | 'view' | 'edit'> = {
  dashboard: 'edit',
  reports: 'edit',
  projects: 'edit',
  alerts: 'edit',
  lists: 'edit',
  drive_links: 'edit',
  seguimiento: 'edit',
  peticiones: 'edit',
  file_cleaner: 'none',
  performance: 'none',
};

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

// Admin siempre puede; si no, revisa el permiso de esta persona para ese
// módulo. Un módulo SIN entrada en permisos (nunca se guardó explícitamente)
// cae al default de MODULE_DEFAULT_LEVEL -- igual que levelOf() en
// src/auth/AuthContext.tsx ("user.permissions[module] ?? MODULE_DEFAULT_LEVEL[module]").
// Antes acá el default era 'edit' GLOBAL para cualquier módulo sin entrada,
// no por módulo: un módulo nuevo registrado como 'none' por defecto (la
// regla del proyecto para módulos admin-only) quedaba editable en el
// backend igual, aunque el frontend lo mantuviera oculto -- el chequeo
// pasaba a ser pura decoración de UI.
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
  const storedLevel = (row.permissions ?? {})[moduleKey];
  const level = storedLevel ?? MODULE_DEFAULT_LEVEL[moduleKey] ?? 'edit';
  return level === 'edit';
}

// Para los pasos de flujo "requiere revisión": necesitamos saber QUIÉN está
// autenticado (no solo si puede editar), para comparar su email contra el
// contacto Principal del paso -- es la única persona (junto con un admin)
// que puede dar visto bueno u observación en esos pasos.
export async function getSessionUser(
  request: { headers: { cookie?: string } },
  sql: SqlClient,
): Promise<{ email: string; isAdmin: boolean } | null> {
  const sessionId = readCookie(request, 'app_session');
  if (!sessionId) return null;
  const [row] = (await sql`
    SELECT u.email, u.es_admin AS "isAdmin"
    FROM app_sesiones s
    JOIN usuarios_autorizados u ON u.email = s.email
    WHERE s.session_id = ${sessionId} AND s.expires_at > NOW() AND u.activo = TRUE
  `) as any[];
  return row ? { email: row.email, isAdmin: Boolean(row.isAdmin) } : null;
}

// Admin ve todos los proyectos. Si no, revisa usuario_proyectos: sin
// ninguna fila para este email significa "todos" (mismo criterio
// "permitido salvo restricción explícita" que canEditModuleRequest arriba)
// -- así nadie pierde acceso por defecto; el admin restringe a alguien
// insertando filas específicas para su email desde Usuarios.
export async function getAccessibleProjectIds(
  request: { headers: { cookie?: string } },
  sql: SqlClient,
): Promise<'all' | number[]> {
  const sessionId = readCookie(request, 'app_session');
  if (!sessionId) return [];
  const [row] = (await sql`
    SELECT u.email, u.es_admin AS "isAdmin"
    FROM app_sesiones s
    JOIN usuarios_autorizados u ON u.email = s.email
    WHERE s.session_id = ${sessionId} AND s.expires_at > NOW() AND u.activo = TRUE
  `) as any[];
  if (!row) return [];
  if (row.isAdmin) return 'all';
  const rows = (await sql`SELECT proyecto_id AS id FROM usuario_proyectos WHERE email = ${row.email}`) as any[];
  if (rows.length === 0) return 'all';
  return rows.map((r) => Number(r.id));
}
