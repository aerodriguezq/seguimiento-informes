import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSql } from './db.js';

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

export type MetricEventType = 'api_request' | 'client_page_load' | 'client_error';

export type LogMetricInput = {
  eventType: MetricEventType;
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  extra?: Record<string, unknown> | null;
};

// Registrar una métrica nunca debe tumbar la petición real que la originó --
// cualquier falla (tabla no migrada todavía, DB momentáneamente caída) se
// traga acá y solo queda en los logs de Vercel.
export async function logMetric(sql: SqlClient, input: LogMetricInput): Promise<void> {
  try {
    await sql`
      INSERT INTO app_metrics (event_type, route, method, status_code, duration_ms, error_message, extra)
      VALUES (
        ${input.eventType}, ${input.route ?? null}, ${input.method ?? null}, ${input.statusCode ?? null},
        ${input.durationMs ?? null}, ${input.errorMessage ?? null},
        ${input.extra ? JSON.stringify(input.extra) : null}::jsonb
      )
    `;
    // Limpieza oportunista en vez de un cron aparte: 1 de cada ~200
    // inserciones de paso borra lo más viejo que 30 días, así la tabla no
    // crece para siempre sin depender de un job adicional.
    if (Math.random() < 0.005) {
      await sql`DELETE FROM app_metrics WHERE created_at < NOW() - INTERVAL '30 days'`;
    }
  } catch (error) {
    console.error('No fue posible registrar la métrica', error);
  }
}

// Envuelve un handler de Vercel para medir cuánto se demora y con qué
// código responde, sin que cada endpoint tenga que instrumentarse a mano --
// el handler original queda intacto, esto solo mide alrededor. `routeName`
// es una etiqueta corta y estable (no la URL completa, que puede traer
// ids) para poder agrupar por endpoint en el panel de rendimiento. Puede ser
// fija ('reports') o, para un archivo que despacha varias acciones por query
// param (ej. api/auth/google/[action].ts), una función que la calcula a
// partir del request -- así cada acción se agrupa aparte en vez de todas
// quedar mezcladas bajo un solo nombre genérico.
export function withApiMetrics(
  routeName: string | ((request: VercelRequest) => string),
  handler: (request: VercelRequest, response: VercelResponse) => unknown,
): (request: VercelRequest, response: VercelResponse) => Promise<void> {
  return async (request: VercelRequest, response: VercelResponse) => {
    const resolvedRoute = typeof routeName === 'function' ? routeName(request) : routeName;
    const start = Date.now();
    let capturedStatus = 200;
    const originalStatus = response.status.bind(response);
    response.status = ((code: number) => {
      capturedStatus = code;
      return originalStatus(code);
    }) as typeof response.status;

    let thrown: unknown = null;
    try {
      await handler(request, response);
    } catch (error) {
      thrown = error;
      if (capturedStatus < 400) capturedStatus = 500;
    }

    try {
      const sql = await getSql();
      await logMetric(sql, {
        eventType: 'api_request',
        route: resolvedRoute,
        method: request.method ?? null,
        statusCode: capturedStatus,
        durationMs: Date.now() - start,
        errorMessage: thrown instanceof Error ? thrown.message : thrown ? String(thrown) : null,
      });
    } catch (metricsError) {
      console.error('No fue posible medir esta petición', metricsError);
    }

    if (thrown) throw thrown;
  };
}
