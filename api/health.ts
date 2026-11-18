import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSql } from '../server/db.js';
import { logMetric, withApiMetrics, type MetricEventType } from '../server/metrics.js';
import { isAdminRequest } from '../server/admin-auth.js';

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

async function handlePing(response: VercelResponse) {
  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl?.trim()) {
      return response.status(503).json({
        data: null,
        meta: {},
        errors: ['DATABASE_URL no está configurada en Vercel.'],
      });
    }

    const sql = await getSql();
    const result = await sql`SELECT NOW() AS connected_at`;

    return response.status(200).json({
      data: {
        database: 'neon',
        connectedAt: result[0]?.connected_at ?? null,
      },
      meta: {},
      errors: [],
    });
  } catch (error) {
    console.error('Neon health check failed', error);

    return response.status(503).json({
      data: null,
      meta: {},
      errors: ['No fue posible conectar con la base de datos.'],
    });
  }
}

// Resumen de eficiencia de TODA la app, de los últimos 7 días: cuánto se
// demora cada función de la API, cuántas peticiones recibe, qué porcentaje
// falla, y lo mismo del lado del navegador (carga de página, errores de JS
// sin capturar). Solo admin -- expone rutas internas y mensajes de error que
// no deberían verse fuera de eso.
async function handleSummary(request: VercelRequest, response: VercelResponse, sql: SqlClient) {
  if (!(await isAdminRequest(request, sql))) {
    return response.status(403).json({ data: null, meta: {}, errors: ['Solo un administrador puede ver el panel de rendimiento.'] });
  }

  const [routeRows, recentErrors, pageLoad, totals] = await Promise.all([
    sql`
      SELECT route, method,
        COUNT(*) AS "requestCount",
        COUNT(*) FILTER (WHERE status_code >= 400) AS "errorCount",
        ROUND(AVG(duration_ms)) AS "avgDurationMs",
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)) AS "p95DurationMs",
        MAX(duration_ms) AS "maxDurationMs"
      FROM app_metrics
      WHERE event_type = 'api_request' AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY route, method
      ORDER BY "requestCount" DESC
    `,
    sql`
      SELECT event_type AS "eventType", route, method, status_code AS "statusCode",
        duration_ms AS "durationMs", error_message AS "errorMessage", created_at AS "createdAt"
      FROM app_metrics
      WHERE (event_type = 'api_request' AND status_code >= 400) OR event_type = 'client_error'
      ORDER BY created_at DESC
      LIMIT 25
    `,
    sql`
      SELECT COUNT(*) AS "loadCount", ROUND(AVG(duration_ms)) AS "avgDurationMs",
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)) AS "p95DurationMs"
      FROM app_metrics WHERE event_type = 'client_page_load' AND created_at > NOW() - INTERVAL '7 days'
    `,
    sql`
      SELECT COUNT(*) AS "totalRequests", COUNT(*) FILTER (WHERE status_code >= 400) AS "totalErrors"
      FROM app_metrics WHERE event_type = 'api_request' AND created_at > NOW() - INTERVAL '7 days'
    `,
  ]);

  return response.status(200).json({
    data: {
      windowDays: 7,
      totals: totals[0] ?? { totalRequests: 0, totalErrors: 0 },
      routes: routeRows,
      recentErrors,
      pageLoad: pageLoad[0] ?? { loadCount: 0, avgDurationMs: null, p95DurationMs: null },
    },
    meta: {},
    errors: [],
  });
}

// El navegador manda acá cuánto tardó en cargar la página (Navigation
// Timing) y cualquier error de JavaScript sin capturar -- sin login
// requerido, porque un error puede pasar justo en la pantalla de login.
async function handleClientBeacon(request: VercelRequest, response: VercelResponse, sql: SqlClient) {
  const { type, route, durationMs, errorMessage } = request.body ?? {};
  const eventType: MetricEventType | null = type === 'page_load' ? 'client_page_load' : type === 'error' ? 'client_error' : null;
  if (!eventType) {
    return response.status(400).json({ data: null, meta: {}, errors: ['Tipo de métrica no reconocido.'] });
  }

  await logMetric(sql, {
    eventType,
    route: typeof route === 'string' ? route.slice(0, 200) : null,
    durationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
    errorMessage: typeof errorMessage === 'string' ? errorMessage.slice(0, 2000) : null,
  });

  return response.status(204).end();
}

async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method === 'POST') {
    const sql = await getSql();
    return handleClientBeacon(request, response, sql);
  }

  if (request.method !== 'GET') {
    return response.status(405).json({
      data: null,
      meta: {},
      errors: ['Método no permitido.'],
    });
  }

  if (request.query?.action === 'summary') {
    const sql = await getSql();
    return handleSummary(request, response, sql);
  }

  return handlePing(response);
}

export default withApiMetrics('health', handler);
