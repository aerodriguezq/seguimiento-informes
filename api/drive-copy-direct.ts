import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDriveSession } from '../server/google-oauth.js';
import { getSql } from '../server/db.js';
import {
  getDriveAccessToken,
  scanDriveTreeChunk,
  copyDriveItemsBatch,
  initialDriveScanQueue,
  emptyDriveCopySummary,
  type DriveScanQueueItem,
  type DriveCopySummary,
  type DriveCopyLogEntry,
} from '../server/google-drive.js';

function folderIdFromUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  return value.match(/\/folders\/([\w-]+)/)?.[1] ?? null;
}

// Deja más margen con reintentos por límite de tasa de Drive; el troceo en
// fases (escaneo -> copia por lotes, ver server/google-drive.ts) es lo que
// de verdad evita que una copia grande choque contra este límite -- antes
// una sola carpeta de origen con miles de archivos directos reventaba el
// arreglo compartido que se reenviaba entero en cada invocación.
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

  try {
    const session = await getDriveSession(request);
    if (!session) return response.status(401).json({ data: null, meta: {}, errors: ['Conecta Google Drive antes de copiar.'] });

    const sql = await getSql();
    const action = request.body?.action;
    let jobId = typeof request.body?.jobId === 'string' ? request.body.jobId : null;

    if (action === 'cancel') {
      if (!jobId) return response.status(400).json({ data: null, meta: {}, errors: ['Falta jobId.'] });
      await sql`UPDATE drive_copy_jobs SET status = 'cancelled', phase = 'cancelled', updated_at = NOW() WHERE job_id = ${jobId}`;
      return response.status(200).json({ data: { cancelled: true }, meta: {}, errors: [] });
    }

    if (!jobId) {
      const sourceId = folderIdFromUrl(request.body?.sourceUrl);
      const destinationId = folderIdFromUrl(request.body?.destinationUrl);
      if (!sourceId || !destinationId) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Los enlaces de origen y destino no son carpetas Drive válidas.'] });
      }
      jobId = crypto.randomUUID();
      await sql`
        INSERT INTO drive_copy_jobs (job_id, status, phase, scan_queue, summary, log, source_root_id, destination_root_id)
        VALUES (
          ${jobId}, 'running', 'scanning', ${JSON.stringify(initialDriveScanQueue(sourceId))}::jsonb,
          ${JSON.stringify(emptyDriveCopySummary())}::jsonb, '[]'::jsonb, ${sourceId}, ${destinationId}
        )
      `;
    }

    const [job] = (await sql`
      SELECT status, phase, scan_queue AS "scanQueue", summary, destination_root_id AS "destinationRootId"
      FROM drive_copy_jobs WHERE job_id = ${jobId}
    `) as any[];
    if (!job) return response.status(404).json({ data: null, meta: {}, errors: ['Esta copia ya no existe (puede haber expirado).'] });
    if (job.status === 'cancelled') {
      return response.status(200).json({ data: { jobId, done: true, cancelled: true, ...job.summary }, meta: {}, errors: [] });
    }

    const accessToken = await getDriveAccessToken(session.token_json);
    const deadline = Date.now() + CHUNK_BUDGET_MS;

    if (job.phase === 'scanning') {
      const scanQueue = job.scanQueue as DriveScanQueueItem[];
      const result = await scanDriveTreeChunk(sql, accessToken, jobId, scanQueue, deadline);

      if (connectionClosed) {
        await sql`UPDATE drive_copy_jobs SET status = 'cancelled', phase = 'cancelled', updated_at = NOW() WHERE job_id = ${jobId}`;
        return response.status(200).json({ data: { jobId, done: true, cancelled: true }, meta: {}, errors: [] });
      }

      if (!result.done) {
        await sql`UPDATE drive_copy_jobs SET scan_queue = ${JSON.stringify(result.scanQueue)}::jsonb, updated_at = NOW() WHERE job_id = ${jobId}`;
        const [{ itemsFound }] = (await sql`SELECT COUNT(*) AS "itemsFound" FROM drive_copy_items WHERE job_id = ${jobId}`) as any[];
        return response.status(200).json({
          data: { jobId, done: false, cancelled: false, phase: 'scanning', itemsFound: Number(itemsFound), ...emptyDriveCopySummary() },
          meta: {}, errors: [],
        });
      }

      await sql`UPDATE drive_copy_jobs SET phase = 'copying', scan_queue = '[]'::jsonb, updated_at = NOW() WHERE job_id = ${jobId}`;
      const [{ itemsFound }] = (await sql`SELECT COUNT(*) AS "itemsFound" FROM drive_copy_items WHERE job_id = ${jobId}`) as any[];
      return response.status(200).json({
        data: { jobId, done: false, cancelled: false, phase: 'copying', itemsFound: Number(itemsFound), ...emptyDriveCopySummary() },
        meta: {}, errors: [],
      });
    }

    // phase === 'copying'
    const summary: DriveCopySummary = job.summary;
    const result = await copyDriveItemsBatch(sql, accessToken, jobId, job.destinationRootId, summary, deadline, () => connectionClosed);

    if (result.cancelled) {
      await sql`
        UPDATE drive_copy_jobs SET status = 'cancelled', phase = 'cancelled', summary = ${JSON.stringify(result.summary)}::jsonb, updated_at = NOW()
        WHERE job_id = ${jobId}
      `;
      return response.status(200).json({ data: { jobId, done: true, cancelled: true, ...result.summary }, meta: {}, errors: [] });
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
        data: { jobId, done: true, cancelled: false, phase: 'done', total: Number(total), ...result.summary, log },
        meta: {}, errors: [],
      });
    }

    await sql`UPDATE drive_copy_jobs SET summary = ${JSON.stringify(result.summary)}::jsonb, updated_at = NOW() WHERE job_id = ${jobId}`;
    return response.status(200).json({
      data: { jobId, done: false, cancelled: false, phase: 'copying', total: Number(total), ...result.summary },
      meta: {}, errors: [],
    });
  } catch (error) {
    console.error('Direct Drive copy failed', error);
    return response.status(502).json({ data: null, meta: {}, errors: [error instanceof Error ? error.message : 'No fue posible copiar la carpeta desde Google Drive.'] });
  }
}
