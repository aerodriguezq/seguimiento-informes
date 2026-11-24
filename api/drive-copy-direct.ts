import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDriveSession } from '../server/google-oauth.js';
import { getSql } from '../server/db.js';
import { canEditModuleRequest } from '../server/admin-auth.js';
import {
  getDriveAccessToken,
  copyDriveItemsBatch,
  validateDriveItemsBatch,
  scanSourceItemsBatch,
  seedDriveCopyRoot,
  emptyDriveCopySummary,
  emptyDriveValidateSummary,
  type DriveCopySummary,
  type DriveValidateSummary,
  type DriveCopyLogEntry,
} from '../server/google-drive.js';
import { withApiMetrics } from '../server/metrics.js';

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

export type DriveTreeNode = { name: string; isFolder: boolean; relativePath: string; children: DriveTreeNode[] };

// Arma el árbol anidado (no la lista plana de buildJobLog) de un job de
// mapeo -- "Mapear origen"/"Mapear destino" lo muestran como HTML en
// cascada en vez de una lista. parent_item_id ya trae la jerarquía real,
// solo hay que agrupar cada fila bajo la de su padre.
async function buildJobTree(sql: SqlClient, jobId: string): Promise<{ total: number; tree: DriveTreeNode[] }> {
  const rows = (await sql`
    SELECT item_id AS id, parent_item_id AS "parentId", name, is_folder AS "isFolder", relative_path AS "relativePath"
    FROM drive_copy_items WHERE job_id = ${jobId} ORDER BY is_folder DESC, name ASC
  `) as any[];
  const byId = new Map<number, DriveTreeNode & { id: number; parentId: number | null }>();
  for (const row of rows) {
    byId.set(row.id, { id: row.id, parentId: row.parentId, name: row.name, isFolder: !!row.isFolder, relativePath: row.relativePath, children: [] });
  }
  const roots: DriveTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId !== null ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return { total: rows.length, tree: roots };
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

// Antes de copiar o validar nada, un job nuevo arranca en fase
// "scanning_copying"/"scanning_validating": mapea TODO el árbol de origen
// primero (scanSourceItemsBatch), para que el total mostrado sea el real
// desde el principio en vez de ir creciendo sobre la marcha. Esta función
// concentra esa transición -- si el mapeo termina con tiempo de sobra, sigue
// de una vez con la copia/validación real en la MISMA invocación, en vez de
// hacer esperar otra ida y vuelta solo para eso.
async function advanceJob(
  sql: SqlClient,
  accessToken: string,
  jobId: string,
  job: { phase: string; summary: unknown; destinationRootId: string },
  deadline: number,
  isCancelled: () => boolean,
) {
  let phase = job.phase;

  // "Mapear origen"/"Mapear destino": mapeo puro, sin copiar ni validar
  // nada después -- esta fase ES la fase final del job (nunca transiciona a
  // 'copying'/'validating' como sí hace la fase de mapeo previo de abajo).
  if (phase === 'scanning_only' || phase === 'scanning_destination') {
    const scanResult = await scanSourceItemsBatch(sql, accessToken, jobId, deadline, isCancelled);
    if (scanResult.cancelled) return { kind: 'mapping' as const, done: false, cancelled: true };
    return { kind: 'mapping' as const, done: scanResult.done, cancelled: false };
  }

  if (phase === 'scanning_copying' || phase === 'scanning_validating') {
    const scanResult = await scanSourceItemsBatch(sql, accessToken, jobId, deadline, isCancelled);
    if (scanResult.cancelled) return { kind: 'scanning' as const, done: false, cancelled: true };
    if (!scanResult.done) return { kind: 'scanning' as const, done: false, cancelled: false };
    phase = phase === 'scanning_validating' ? 'validating' : 'copying';
    await sql`UPDATE drive_copy_jobs SET phase = ${phase}, updated_at = NOW() WHERE job_id = ${jobId}`;
    if (isCancelled() || Date.now() > deadline) {
      return { kind: 'scanning' as const, done: false, cancelled: isCancelled() };
    }
  }

  if (phase === 'validating') {
    const result = await validateDriveItemsBatch(sql, accessToken, jobId, job.destinationRootId, job.summary as DriveValidateSummary, deadline, isCancelled);
    return { kind: 'validate' as const, ...result };
  }
  const result = await copyDriveItemsBatch(sql, accessToken, jobId, job.destinationRootId, job.summary as DriveCopySummary, deadline, isCancelled);
  return { kind: 'copy' as const, ...result };
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
    const result = await advanceJob(sql, accessToken, job.id, job, deadline, () => false);
    jobsProcessed++;
    if (result.kind === 'scanning') {
      // Sigue 'running' tal cual -- el mapeo mismo ya actualiza su propio
      // progreso fila por fila; el siguiente tick retoma donde quedó, o si
      // ya terminó, pasa derecho a copiar/validar.
      continue;
    }
    if (result.kind === 'mapping') {
      // "Mapear origen"/"Mapear destino" no tienen summary (no copian ni
      // comparan nada) -- solo hace falta marcar 'done' cuando termina.
      if (result.done) {
        await sql`UPDATE drive_copy_jobs SET status = 'done', updated_at = NOW() WHERE job_id = ${job.id}`;
        jobsCompleted++;
      }
      continue;
    }
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

async function handler(request: VercelRequest, response: VercelResponse) {
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
    if (!(await canEditModuleRequest(request, sql, 'drive_links'))) {
      return response.status(403).json({ data: null, meta: {}, errors: ['No tienes permiso de edición en Fuentes Drive.'] });
    }
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
          jobId, phase: statusJob.phase, scanning: String(statusJob.phase).startsWith('scanning'),
          cancelled: statusJob.status === 'cancelled', done: statusJob.status === 'done',
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

    // "Mapear origen"/"Mapear destino": mapeo de solo lectura de UNA sola
    // carpeta (no hace falta el par origen+destino). Igual que Validar,
    // reusa un mapeo de esa misma carpeta hecho en el último día en vez de
    // recorrer Drive otra vez, salvo que pidan "force" (botón "Remapear").
    if (!jobId && (action === 'mapSource' || action === 'mapDestination')) {
      const isSource = action === 'mapSource';
      const targetUrl = isSource ? request.body?.sourceUrl : request.body?.destinationUrl;
      const targetId = folderIdFromUrl(targetUrl);
      if (!targetId) {
        return response.status(400).json({
          data: null, meta: {}, errors: [`El enlace de ${isSource ? 'origen' : 'destino'} no es una carpeta Drive válida.`],
        });
      }
      const mappingPhase = isSource ? 'scanning_only' : 'scanning_destination';

      if (!request.body?.force) {
        const [cached] = (await sql`
          SELECT job_id AS id, updated_at AS "updatedAt"
          FROM drive_copy_jobs
          WHERE phase = ${mappingPhase} AND status = 'done'
            AND source_root_id = ${targetId} AND updated_at > NOW() - INTERVAL '1 day'
          ORDER BY updated_at DESC LIMIT 1
        `) as any[];
        if (cached) {
          const { total: cachedTotal, tree } = await buildJobTree(sql, cached.id);
          return response.status(200).json({
            data: { jobId: cached.id, done: true, cancelled: false, mapping: true, total: cachedTotal, tree, cached: true, cachedAt: cached.updatedAt },
            meta: {}, errors: [],
          });
        }
      }

      jobId = crypto.randomUUID();
      await sql`
        INSERT INTO drive_copy_jobs (job_id, status, phase, scan_queue, summary, log, source_root_id, destination_root_id)
        VALUES (${jobId}, 'running', ${mappingPhase}, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, ${targetId}, NULL)
      `;
      await seedDriveCopyRoot(sql, jobId, accessToken, targetId);
    }

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
      // Solo se siembra la fila raíz -- el resto del árbol lo mapea la fase
      // "scanning_*" de abajo (scanSourceItemsBatch) antes de copiar o
      // validar nada de verdad.
      await sql`
        INSERT INTO drive_copy_jobs (job_id, status, phase, scan_queue, summary, log, source_root_id, destination_root_id)
        VALUES (
          ${jobId}, 'running', ${isValidate ? 'scanning_validating' : 'scanning_copying'}, '[]'::jsonb,
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
    const result = await advanceJob(sql, accessToken, jobId, job, deadline, () => connectionClosed);

    if (result.kind === 'mapping') {
      if (result.cancelled) {
        await sql`UPDATE drive_copy_jobs SET status = 'cancelled', phase = 'cancelled', updated_at = NOW() WHERE job_id = ${jobId}`;
        return response.status(200).json({ data: { jobId, done: true, cancelled: true, mapping: true, total: 0, tree: [] }, meta: {}, errors: [] });
      }
      if (result.done) {
        await sql`UPDATE drive_copy_jobs SET status = 'done', updated_at = NOW() WHERE job_id = ${jobId}`;
        const { total, tree } = await buildJobTree(sql, jobId);
        return response.status(200).json({ data: { jobId, done: true, cancelled: false, mapping: true, total, tree }, meta: {}, errors: [] });
      }
      const [{ total: mapTotal }] = (await sql`SELECT COUNT(*) AS total FROM drive_copy_items WHERE job_id = ${jobId}`) as any[];
      return response.status(200).json({
        data: { jobId, done: false, cancelled: false, mapping: true, scanning: true, total: Number(mapTotal) },
        meta: {}, errors: [],
      });
    }

    if (result.kind === 'scanning') {
      if (result.cancelled) {
        await sql`UPDATE drive_copy_jobs SET status = 'cancelled', phase = 'cancelled', updated_at = NOW() WHERE job_id = ${jobId}`;
        const { total: cancelledTotal, log: cancelledLog } = await buildJobLog(sql, jobId);
        return response.status(200).json({
          data: { jobId, done: true, cancelled: true, scanning: true, total: cancelledTotal, log: cancelledLog, recentItems: [] },
          meta: {}, errors: [],
        });
      }
      // El mapeo previo (scanSourceItemsBatch) ya va guardando su propio
      // avance fila por fila -- acá solo se reporta cuántos elementos de
      // origen se alcanzaron a ver hasta ahora, nunca un porcentaje (el
      // total real todavía no se conoce del todo mientras sigue mapeando).
      const [{ total: scanTotal }] = (await sql`SELECT COUNT(*) AS total FROM drive_copy_items WHERE job_id = ${jobId}`) as any[];
      return response.status(200).json({
        data: { jobId, done: false, cancelled: false, phase: job.phase, scanning: true, total: Number(scanTotal), recentItems: [] },
        meta: {}, errors: [],
      });
    }

    const nextPhase = result.kind === 'validate' ? 'validating' : 'copying';

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

export default withApiMetrics('drive-copy-direct', handler);
