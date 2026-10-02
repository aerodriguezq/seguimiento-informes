import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDriveSession } from '../server/google-oauth.js';
import { getSql } from '../server/db.js';
import {
  getDriveAccessToken,
  copyDriveTreeChunk,
  initialDriveCopyQueue,
  emptyDriveCopySummary,
  type DriveCopyQueueItem,
  type DriveCopySummary,
  type DriveCopyLogEntry,
} from '../server/google-drive.js';

function folderIdFromUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  return value.match(/\/folders\/([\w-]+)/)?.[1] ?? null;
}

// Deja más margen con reintentos por límite de tasa de Drive; el troceo en
// chunks de abajo es lo que de verdad evita que una copia grande choque
// contra este límite (antes la función corría de un tirón y Vercel la
// mataba a los 60s en carpetas grandes).
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
      await sql`UPDATE drive_copy_jobs SET status = 'cancelled', updated_at = NOW() WHERE job_id = ${jobId}`;
      return response.status(200).json({ data: { cancelled: true }, meta: {}, errors: [] });
    }

    let queue: DriveCopyQueueItem[];
    let summary: DriveCopySummary;
    let log: DriveCopyLogEntry[];

    if (jobId) {
      const [job] = (await sql`SELECT status, queue, summary, log FROM drive_copy_jobs WHERE job_id = ${jobId}`) as any[];
      if (!job) return response.status(404).json({ data: null, meta: {}, errors: ['Esta copia ya no existe (puede haber expirado).'] });
      if (job.status === 'cancelled') {
        return response.status(200).json({ data: { jobId, done: true, cancelled: true, ...job.summary, log: job.log }, meta: {}, errors: [] });
      }
      queue = job.queue;
      summary = job.summary;
      log = job.log;
    } else {
      const sourceId = folderIdFromUrl(request.body?.sourceUrl);
      const destinationId = folderIdFromUrl(request.body?.destinationUrl);
      if (!sourceId || !destinationId) {
        return response.status(400).json({ data: null, meta: {}, errors: ['Los enlaces de origen y destino no son carpetas Drive válidas.'] });
      }
      jobId = crypto.randomUUID();
      queue = initialDriveCopyQueue(sourceId, destinationId);
      summary = emptyDriveCopySummary();
      log = [];
      await sql`
        INSERT INTO drive_copy_jobs (job_id, status, queue, summary, log)
        VALUES (${jobId}, 'running', ${JSON.stringify(queue)}::jsonb, ${JSON.stringify(summary)}::jsonb, ${JSON.stringify(log)}::jsonb)
      `;
    }

    const accessToken = await getDriveAccessToken(session.token_json);
    const deadline = Date.now() + CHUNK_BUDGET_MS;
    const result = await copyDriveTreeChunk(accessToken, queue, summary, log, deadline, () => connectionClosed);

    if (result.cancelled) {
      await sql`
        UPDATE drive_copy_jobs SET status = 'cancelled', queue = ${JSON.stringify(result.queue)}::jsonb,
          summary = ${JSON.stringify(result.summary)}::jsonb, log = ${JSON.stringify(result.log)}::jsonb, updated_at = NOW()
        WHERE job_id = ${jobId}
      `;
      return response.status(200).json({ data: { jobId, done: true, cancelled: true, ...result.summary, log: result.log }, meta: {}, errors: [] });
    }

    if (result.done) {
      await sql`
        UPDATE drive_copy_jobs SET status = 'done', queue = '[]'::jsonb,
          summary = ${JSON.stringify(result.summary)}::jsonb, log = ${JSON.stringify(result.log)}::jsonb, updated_at = NOW()
        WHERE job_id = ${jobId}
      `;
      return response.status(200).json({ data: { jobId, done: true, cancelled: false, ...result.summary, log: result.log }, meta: {}, errors: [] });
    }

    await sql`
      UPDATE drive_copy_jobs SET queue = ${JSON.stringify(result.queue)}::jsonb,
        summary = ${JSON.stringify(result.summary)}::jsonb, log = ${JSON.stringify(result.log)}::jsonb, updated_at = NOW()
      WHERE job_id = ${jobId}
    `;
    return response.status(200).json({
      data: { jobId, done: false, cancelled: false, ...result.summary, remaining: result.queue.length },
      meta: {},
      errors: [],
    });
  } catch (error) {
    console.error('Direct Drive copy failed', error);
    return response.status(502).json({ data: null, meta: {}, errors: [error instanceof Error ? error.message : 'No fue posible copiar la carpeta desde Google Drive.'] });
  }
}
