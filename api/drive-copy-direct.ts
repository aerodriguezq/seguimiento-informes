import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDriveSession } from '../server/google-oauth.js';
import { getSql } from '../server/db.js';
import {
  getDriveAccessToken,
  copyDriveItemsBatch,
  validateDriveItemsBatch,
  seedDriveCopyRoot,
  emptyDriveCopySummary,
  emptyDriveValidateSummary,
  type DriveCopySummary,
  type DriveValidateSummary,
  type DriveCopyLogEntry,
} from '../server/google-drive.js';

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

function folderIdFromUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  return value.match(/\/folders\/([\w-]+)/)?.[1] ?? null;
}

// Informe descargable (CSV) de todo lo que un job alcanzó a hacer -- se
// arma igual al terminar de verdad que al detenerlo a propósito, para que
// quien lo pare siempre tenga un registro de dónde quedó, no solo al
// completarlo entero.
async function buildJobLog(sql: SqlClient, jobId: string): Promise<{ total: number; log: DriveCopyLogEntry[] }> {
  const rows = (await sql`
    SELECT relative_path AS "relativePath", name, is_folder AS "isFolder", mime_type AS "mimeType", status, error_message AS "errorMessage"
    FROM drive_copy_items WHERE job_id = ${jobId} ORDER BY item_id ASC
  `) as any[];
  const log: DriveCopyLogEntry[] = rows.map((r) => ({
    relativePath: r.relativePath, name: r.name, isFolder: !!r.isFolder, mimeType: r.mimeType, status: r.status, errorMessage: r.errorMessage,
  }));
  return { total: rows.length, log };
}

// Deja más margen con reintentos por límite de tasa de Drive; el troceo por
// lotes (ver server/google-drive.ts, que copia y descubre a la vez) es lo
// que de verdad evita que una copia grande choque contra este límite --
// antes una sola carpeta de origen con miles de archivos directos reventaba
// el arreglo compartido que se reenviaba entero en cada invocación.
export const config = { maxDuration: 60 };

// Por debajo del límite de la función: deja tiempo de sobra para guardar el
// progreso en la base antes de que Vercel corte la ejecución.
const CHUNK_BUDGET_MS = 40000;

// Igual que getConnectedAccessToken en api/reports.ts -- no depende de la
// cookie de sesión del navegador (no hay ninguna en un barrido por cron),
// usa la cuenta de Google conectada más reciente.
async function getMostRecentAccessToken(sql: SqlClient): Promise<string | null> {
  const session = (await sql`
    SELECT token_json FROM google_drive_sessions WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1
  `) as any[];
  if (!session[0]) return null;
  return getDriveAccessToken(session[0].token_json);
}

// Para que una copia (o validación) siga avanzando aunque la persona cierre
// la pestaña, apague el computador o pierda la sesión -- GitHub Actions
// "toca la puerta" cada 15 min (igual que los demás barridos) y esto
// adelanta un poco cada job que siga en estado "running", sin depender de
// que nadie tenga la página abierta sondeando. Si la pestaña SÍ está
// abierta, el sondeo en vivo sigue siendo mucho más rápido (cada 1-2s); el
// barrido es la red de seguridad para cuando no lo está.
async function handleDriveCopySweep(sql: SqlClient): Promise<{ jobsProcessed: number; jobsCompleted: number; skipped?: string }> {
  const runningJobs = (await sql`
    SELECT job_id AS id, phase, summary, destination_root_id AS "destinationRootId"
    FROM drive_copy_jobs WHERE status = 'running' ORDER BY updated_at ASC
  `) as any[];
  if (runningJobs.length === 0) return { jobsProcessed: 0, jobsCompleted: 0, skipped: 'no-running-jobs' };

  const accessToken = await getMostRecentAccessToken(sql);
  if (!accessToken) return { jobsProcessed: 0, jobsCompleted: 0, skipped: 'no-connected-google-account' };

  const deadline = Date.now() + CHUNK_BUDGET_MS;
  let jobsProcessed = 0;
  let jobsCompleted = 0;

  for (const job of runningJobs) {
    if (Date.now() > deadline) break;
    const isValidate = job.phase === 'validating';
    const result = isValidate
      ? await validateDriveItemsBatch(sql, accessToken, job.id, job.destinationRootId, job.summary as DriveValidateSummary, deadline)
      : await copyDriveItemsBatch(sql, accessToken, job.id, job.destinationRootId, job.summary as DriveCopySummary, deadline);
    jobsProcessed++;
    if (result.done) {
      // `phase` NO se pisa a 'done' -- se deja como 'validating'/'copying'
      // (qué tipo de job era) para que el caché de un día de Validar lo
      // pueda seguir identificando después de terminado; `status = 'done'`
      // ya basta para saber que terminó.
      await sql`
        UPDATE drive_copy_jobs SET status = 'done', summary = ${JSON.stringify(result.summary)}::jsonb, updated_at = NOW()
        WHERE job_id = ${job.id}
      `;
      jobsCompleted++;
    } else {
      await sql`UPDATE drive_copy_jobs SET summary = ${JSON.stringify(result.summary)}::jsonb, updated_at = NOW() WHERE job_id = ${job.id}`;
    }
  }
  return { jobsProcessed, jobsCompleted };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method === 'GET') {
    const cronSecret = process.env.CRON_SECRET;
    const isCronRequest = !!cronSecret && request.headers.authorization === `Bearer ${cronSecret}`;
    if (!isCronRequest) return response.status(401).json({ data: null, meta: {}, errors: ['No autorizado.'] });
    try {
      const sql = await getSql();
      const result = await handleDriveCopySweep(sql);
      return response.status(200).json({ data: result, meta: {}, errors: [] });
    } catch (error) {
      console.error('Drive copy background sweep failed', error);
      const message = error instanceof Error ? error.message : 'No fue posible continuar las copias de Drive en segundo plano.';
      return response.status(502).json({ data: null, meta: {}, errors: [message] });
    }
  }

  if (request.method !== 'POST') return response.status(405).json({ data: null, meta: {}, errors: ['Método no permitido.'] });

  let connectionClosed = false;
  request.on('close', () => {
    if (!response.writableEnded) connectionClosed = true;
  });

  let session: Awaited<ReturnType<typeof getDriveSession>> = null;
  try {
    session = await getDriveSession(request);
    if (!session) return response.status(401).json({ data: null, meta: {}, errors: ['Conecta Google Drive antes de copiar.'] });

    const sql = await getSql();
    const action = request.body?.action;
    let jobId = typeof request.body?.jobId === 'string' ? request.body.jobId : null;

    if (action === 'cancel') {
      if (!jobId) return response.status(400).json({ data: null, meta: {}, errors: ['Falta jobId.'] });
      // `phase` NO se toca -- se deja como 'validating'/'copying' (de qué
      // tipo era el job) para que, si se retoma más adelante, se sepa cuál
      // función de lote volver a llamar; `status = 'cancelled'` ya basta
      // para saber que está detenido.
      await sql`UPDATE drive_copy_jobs SET status = 'cancelled', updated_at = NOW() WHERE job_id = ${jobId}`;
      // El informe de lo hecho hasta aquí viaja en la MISMA respuesta de
      // cancelar -- este es el único punto donde el frontend siempre pasa,
      // sin importar si el "Detener" interrumpió una petición en vuelo o
      // llegó entre lotes.
      const { total, log } = await buildJobLog(sql, jobId);
      return response.status(200).json({ data: { cancelled: true, total, log }, meta: {}, errors: [] });
    }

    // Solo lectura -- no avanza nada. Sirve para reconstruir el progreso y
    // el log completo de un job en curso al recargar la página, en vez de
    // arrancar en blanco hasta el próximo poll.
    if (action === 'status') {
      if (!jobId) return response.status(400).json({ data: null, meta: {}, errors: ['Falta jobId.'] });
      const [statusJob] = (await sql`SELECT status, phase, summary FROM drive_copy_jobs WHERE job_id = ${jobId}`) as any[];
      if (!statusJob) return response.status(404).json({ data: null, meta: {}, errors: ['Esta copia ya no existe (puede haber expirado).'] });
      const [{ total }] = (await sql`SELECT COUNT(*) AS total FROM drive_copy_items WHERE job_id = ${jobId}`) as any[];
      const doneRows = (await sql`
        SELECT name, relative_path AS "relativePath", is_folder AS "isFolder", status, error_message AS "errorMessage"
        FROM drive_copy_items WHERE job_id = ${jobId} AND status <> 'pending' ORDER BY item_id ASC
      `) as any[];
      return response.status(200).json({
        data: {
          jobId, phase: statusJob.phase, cancelled: statusJob.status === 'cancelled', done: statusJob.status === 'done',
          total: Number(total), ...statusJob.summary, recentItems: doneRows,
        },
        meta: {}, errors: [],
      });
    }

    // Convierte un job de validación YA terminado en uno de copia real: lo
    // que la validación ya encontró que existe en destino queda resuelto
    // tal cual (no hay que volver a listarlo ni compararlo), y solo lo que
    // quedó marcado "missing" (o con error) se reinicia a "pending" para
    // que la copia real lo procese -- así "Copiar lo que falta" no repite
    // el recorrido completo que ya hizo Validar.
    if (action === 'copyMissing') {
      if (!jobId) return response.status(400).json({ data: null, meta: {}, errors: ['Falta jobId.'] });
      const [sourceJob] = (await sql`SELECT status FROM drive_copy_jobs WHERE job_id = ${jobId}`) as any[];
      if (!sourceJob) return response.status(404).json({ data: null, meta: {}, errors: ['Esa validación ya no existe (puede haber expirado).'] });
      if (sourceJob.status !== 'done') {
        return response.status(400).json({ data: null, meta: {}, errors: ['Esa validación todavía no ha terminado.'] });
      }
      // Cuenta lo que YA estaba resuelto por la validación antes de
      // convertirlo -- si el resumen arrancara en ceros, la barra de
      // progreso mostraría "38 de 7422" en vez de reflejar que miles de
      // esos 7422 ya estaban resueltos desde antes (se veía como si casi no
      // hubiera avanzado nada).
      const [{ existingFolders }] = (await sql`
        SELECT COUNT(*) AS "existingFolders" FROM drive_copy_items WHERE job_id = ${jobId} AND is_folder = TRUE AND status = 'exists'
      `) as any[];
      const [{ existingFiles }] = (await sql`
        SELECT COUNT(*) AS "existingFiles" FROM drive_copy_items WHERE job_id = ${jobId} AND is_folder = FALSE AND status = 'exists'
      `) as any[];

      await sql`
        UPDATE drive_copy_items SET status = 'copied', updated_at = NOW()
        WHERE job_id = ${jobId} AND is_folder = TRUE AND status = 'exists'
      `;
      await sql`
        UPDATE drive_copy_items SET status = 'skipped', updated_at = NOW()
        WHERE job_id = ${jobId} AND is_folder = FALSE AND status = 'exists'
      `;
      await sql`
        UPDATE drive_copy_items SET status = 'pending', error_message = NULL, dest_id = NULL, updated_at = NOW()
        WHERE job_id = ${jobId} AND status IN ('missing', 'error')
      `;
      const initialSummary: DriveCopySummary = {
        ...emptyDriveCopySummary(),
        skippedFiles: Number(existingFiles),
        reusedFolders: Number(existingFolders),
      };
      await sql`
        UPDATE drive_copy_jobs SET status = 'running', phase = 'copying', summary = ${JSON.stringify(initialSummary)}::jsonb, updated_at = NOW()
        WHERE job_id = ${jobId}
      `;
      // No retorna -- sigue abajo con el mismo camino que cualquier otro
      // job en phase 'copying', que ya sabe continuar copiando.
    }

    const accessToken = await getDriveAccessToken(session.token_json);

    if (!jobId) {
      const sourceId = folderIdFromUrl(request.body?.sourceUrl);
      const destinationId = folderIdFromUrl(request.body?.destinationUrl);
      if (!sourceId || !destinationId) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Los enlaces de origen y destino no son carpetas Drive válidas.'] });
      }
      const isValidate = action === 'validate';

      // Validar recorre TODO el árbol -- si ya se hizo para este mismo par
      // origen/destino en el último día, se reusa ese resultado tal cual en
      // vez de volver a comparar todo contra Drive otra vez. `force: true`
      // (botón "Revalidar") se salta este caché a propósito.
      if (isValidate && !request.body?.force) {
        const [cached] = (await sql`
          SELECT job_id AS id, summary, updated_at AS "updatedAt"
          FROM drive_copy_jobs
          WHERE phase = 'validating' AND status = 'done'
            AND source_root_id = ${sourceId} AND destination_root_id = ${destinationId}
            AND updated_at > NOW() - INTERVAL '1 day'
          ORDER BY updated_at DESC LIMIT 1
        `) as any[];
        if (cached) {
          const { total: cachedTotal, log } = await buildJobLog(sql, cached.id);
          const recentItems = log.map((entry) => ({
            name: entry.name, relativePath: entry.relativePath, isFolder: entry.isFolder, status: entry.status, errorMessage: entry.errorMessage,
          }));
          return response.status(200).json({
            data: {
              jobId: cached.id, done: true, cancelled: false, phase: 'done', total: cachedTotal,
              ...cached.summary, log, recentItems, cached: true, cachedAt: cached.updatedAt,
            },
            meta: {}, errors: [],
          });
        }
      }

      jobId = crypto.randomUUID();
      // Solo se siembra la fila raíz -- nunca se lee el árbol completo por
      // adelantado. El resto se va descubriendo lote a lote a medida que se
      // copia (o se valida), en server/google-drive.ts.
      await sql`
        INSERT INTO drive_copy_jobs (job_id, status, phase, scan_queue, summary, log, source_root_id, destination_root_id)
        VALUES (
          ${jobId}, 'running', ${isValidate ? 'validating' : 'copying'}, '[]'::jsonb,
          ${JSON.stringify(isValidate ? emptyDriveValidateSummary() : emptyDriveCopySummary())}::jsonb, '[]'::jsonb, ${sourceId}, ${destinationId}
        )
      `;
      await seedDriveCopyRoot(sql, jobId, accessToken, sourceId);
    }

    const [job] = (await sql`
      SELECT status, phase, summary, destination_root_id AS "destinationRootId"
      FROM drive_copy_jobs WHERE job_id = ${jobId}
    `) as any[];
    if (!job) return response.status(404).json({ data: null, meta: {}, errors: ['Esta copia ya no existe (puede haber expirado).'] });
    if (job.status === 'cancelled') {
      // Llegar hasta acá con este jobId (sin pasar por la acción 'cancel'
      // ni 'status') significa que alguien le está pidiendo seguir -- un
      // job detenido a propósito no es un callejón sin salida, retoma
      // justo donde quedó en vez de tener que empezar de cero.
      await sql`UPDATE drive_copy_jobs SET status = 'running', updated_at = NOW() WHERE job_id = ${jobId}`;
      job.status = 'running';
    }

    const deadline = Date.now() + CHUNK_BUDGET_MS;
    const isValidate = job.phase === 'validating';
    const nextPhase = isValidate ? 'validating' : 'copying';
    const result = isValidate
      ? await validateDriveItemsBatch(sql, accessToken, jobId, job.destinationRootId, job.summary as DriveValidateSummary, deadline, () => connectionClosed)
      : await copyDriveItemsBatch(sql, accessToken, jobId, job.destinationRootId, job.summary as DriveCopySummary, deadline, () => connectionClosed);

    if (result.cancelled) {
      await sql`
        UPDATE drive_copy_jobs SET status = 'cancelled', phase = 'cancelled', summary = ${JSON.stringify(result.summary)}::jsonb, updated_at = NOW()
        WHERE job_id = ${jobId}
      `;
      // Al detenerlo a propósito también queda un informe descargable de lo
      // que alcanzó a hacer -- sirve de referencia, aunque reanudar el
      // mismo jobId (o "Copiar lo que falta" sobre una validación) ya
      // retoma solo desde ahí sin necesidad de leer el CSV primero.
      const { total: cancelledTotal, log: cancelledLog } = await buildJobLog(sql, jobId);
      return response.status(200).json({
        data: { jobId, done: true, cancelled: true, total: cancelledTotal, ...result.summary, log: cancelledLog, recentItems: result.recentItems },
        meta: {}, errors: [],
      });
    }

    if (result.done) {
      // `phase` NO se pisa a 'done' -- se deja como 'validating'/'copying'
      // para que el caché de un día de Validar lo pueda seguir
      // identificando después de terminado; `status = 'done'` ya basta
      // para saber que el job terminó.
      await sql`
        UPDATE drive_copy_jobs SET status = 'done', summary = ${JSON.stringify(result.summary)}::jsonb, updated_at = NOW()
        WHERE job_id = ${jobId}
      `;
      const { total, log } = await buildJobLog(sql, jobId);
      return response.status(200).json({
        data: { jobId, done: true, cancelled: false, phase: 'done', total, ...result.summary, log, recentItems: result.recentItems },
        meta: {}, errors: [],
      });
    }

    await sql`UPDATE drive_copy_jobs SET summary = ${JSON.stringify(result.summary)}::jsonb, updated_at = NOW() WHERE job_id = ${jobId}`;
    const [{ total: inProgressTotal }] = (await sql`SELECT COUNT(*) AS total FROM drive_copy_items WHERE job_id = ${jobId}`) as any[];
    return response.status(200).json({
      data: { jobId, done: false, cancelled: false, phase: nextPhase, total: Number(inProgressTotal), ...result.summary, recentItems: result.recentItems },
      meta: {}, errors: [],
    });
  } catch (error) {
    console.error('Direct Drive copy failed', error);
    const message = error instanceof Error ? error.message : 'No fue posible copiar la carpeta desde Google Drive.';
    // Si la conexión quedó inválida (invalid_grant), se borra la sesión
    // guardada -- si no, "Fuentes Drive" seguiría mostrando "conectado"
    // aunque cada operación real falle, sin ninguna señal de que hay que
    // reconectar.
    if (session && message.includes('ya no es válida')) {
      try {
        const sql = await getSql();
        await sql`DELETE FROM google_drive_sessions WHERE session_id = ${session.session_id}`;
      } catch (cleanupError) {
        console.error('No fue posible limpiar la sesión inválida', cleanupError);
      }
    }
    return response.status(502).json({ data: null, meta: {}, errors: [message] });
  }
}
