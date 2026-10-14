import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDriveSession } from '../server/google-oauth.js';
import { getSql } from '../server/db.js';
import {
  getDriveAccessToken,
  copyDriveItemsBatch,
  seedDriveCopyRoot,
  emptyDriveCopySummary,
  type DriveCopySummary,
  type DriveCopyLogEntry,
} from '../server/google-drive.js';

function folderIdFromUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  return value.match(/\/folders\/([\w-]+)/)?.[1] ?? null;
}

// Deja más margen con reintentos por límite de tasa de Drive; el troceo por
// lotes (ver server/google-drive.ts, que copia y descubre a la vez) es lo
// que de verdad evita que una copia grande choque contra este límite --
// antes una sola carpeta de origen con miles de archivos directos reventaba
// el arreglo compartido que se reenviaba entero en cada invocación.
export const config = { maxDuration: 60 };

// Por debajo del límite de la función: deja tiempo de sobra para guardar el
// progreso en la base antes de que Vercel corte la ejecución.
const CHUNK_BUDGET_MS = 45000;

export default async function handler(request: VercelRequest, response: VercelResponse) {
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
      await sql`UPDATE drive_copy_jobs SET status = 'cancelled', phase = 'cancelled', updated_at = NOW() WHERE job_id = ${jobId}`;
      return response.status(200).json({ data: { cancelled: true }, meta: {}, errors: [] });
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
        SELECT name, relative_path AS "relativePath", is_folder AS "isFolder", status
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

    const accessToken = await getDriveAccessToken(session.token_json);

    if (!jobId) {
      const sourceId = folderIdFromUrl(request.body?.sourceUrl);
      const destinationId = folderIdFromUrl(request.body?.destinationUrl);
      if (!sourceId || !destinationId) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Los enlaces de origen y destino no son carpetas Drive válidas.'] });
      }
      jobId = crypto.randomUUID();
      // Solo se siembra la fila raíz -- nunca se lee el árbol completo por
      // adelantado. El resto se va descubriendo lote a lote a medida que se
      // copia, en server/google-drive.ts.
      await sql`
        INSERT INTO drive_copy_jobs (job_id, status, phase, scan_queue, summary, log, source_root_id, destination_root_id)
        VALUES (
          ${jobId}, 'running', 'copying', '[]'::jsonb,
          ${JSON.stringify(emptyDriveCopySummary())}::jsonb, '[]'::jsonb, ${sourceId}, ${destinationId}
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
      return response.status(200).json({ data: { jobId, done: true, cancelled: true, ...job.summary }, meta: {}, errors: [] });
    }

    const deadline = Date.now() + CHUNK_BUDGET_MS;
    const summary: DriveCopySummary = job.summary;
    const result = await copyDriveItemsBatch(sql, accessToken, jobId, job.destinationRootId, summary, deadline, () => connectionClosed);

    if (result.cancelled) {
      await sql`
        UPDATE drive_copy_jobs SET status = 'cancelled', phase = 'cancelled', summary = ${JSON.stringify(result.summary)}::jsonb, updated_at = NOW()
        WHERE job_id = ${jobId}
      `;
      return response.status(200).json({ data: { jobId, done: true, cancelled: true, ...result.summary, recentItems: result.recentItems }, meta: {}, errors: [] });
    }

    const [{ total }] = (await sql`SELECT COUNT(*) AS total FROM drive_copy_items WHERE job_id = ${jobId}`) as any[];

    if (result.done) {
      await sql`
        UPDATE drive_copy_jobs SET status = 'done', phase = 'done', summary = ${JSON.stringify(result.summary)}::jsonb, updated_at = NOW()
        WHERE job_id = ${jobId}
      `;
      const logRows = (await sql`
        SELECT relative_path AS path, name, is_folder AS "isFolder", mime_type AS "mimeType", status
        FROM drive_copy_items WHERE job_id = ${jobId} ORDER BY item_id ASC
      `) as any[];
      const log: DriveCopyLogEntry[] = logRows.map((r) => ({
        path: r.path, name: r.name, type: r.isFolder ? 'folder' : 'file', mimeType: r.mimeType, status: r.status,
      }));
      return response.status(200).json({
        data: { jobId, done: true, cancelled: false, phase: 'done', total: Number(total), ...result.summary, log, recentItems: result.recentItems },
        meta: {}, errors: [],
      });
    }

    await sql`UPDATE drive_copy_jobs SET summary = ${JSON.stringify(result.summary)}::jsonb, updated_at = NOW() WHERE job_id = ${jobId}`;
    return response.status(200).json({
      data: { jobId, done: false, cancelled: false, phase: 'copying', total: Number(total), ...result.summary, recentItems: result.recentItems },
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
