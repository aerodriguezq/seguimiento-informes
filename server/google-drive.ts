import { getGoogleOAuthClient } from './google-oauth.js';

export type DriveFile = { id: string; name: string; mimeType: string };

// Acepta tanto un link completo de carpeta de Drive como un id pelado.
export function extractDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export async function getDriveAccessToken(tokenJson: string) {
  const client = await getGoogleOAuthClient();
  client.setCredentials(JSON.parse(tokenJson));
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('La sesión de Google Drive expiró.');
  return token.token;
}

const MAX_RATE_LIMIT_RETRIES = 6;

function isRateLimitError(status: number, payload: unknown): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const reason = (payload as { error?: { errors?: Array<{ reason?: string }> } })?.error?.errors?.[0]?.reason;
  return reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded' || reason === 'quotaExceeded';
}

async function driveRequest<T>(accessToken: string, path: string, options: RequestInit = {}, attempt = 0): Promise<T> {
  const response = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (isRateLimitError(response.status, payload) && attempt < MAX_RATE_LIMIT_RETRIES) {
      const backoffMs = Math.min(16000, 500 * 2 ** attempt) + Math.floor(Math.random() * 300);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return driveRequest<T>(accessToken, path, options, attempt + 1);
    }
    throw new Error(payload?.error?.message || `Google Drive respondió ${response.status}.`);
  }
  return payload as T;
}

export async function listDriveChildren(accessToken: string, folderId: string) {
  const files: DriveFile[] = [];
  let pageToken = '';
  do {
    const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const page = await driveRequest<{ files: DriveFile[]; nextPageToken?: string }>(
      accessToken,
      `/files?q=${query}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
    );
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

// Busca una subcarpeta por nombre dentro de parentId; la crea si no existe
// todavía (idempotente, para no duplicar la carpeta de un radicado si se
// vuelve a subir un documento después).
export async function ensureDriveFolder(accessToken: string, parentId: string, name: string): Promise<DriveFile> {
  const children = await listDriveChildren(accessToken, parentId);
  const existing = children.find((f) => f.name === name && f.mimeType === 'application/vnd.google-apps.folder');
  if (existing) return existing;
  return driveRequest<DriveFile>(accessToken, '/files?supportsAllDrives=true', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
}

// Sube un archivo (contenido en base64) a una carpeta de Drive vía upload
// multipart — la API de Drive no tiene un endpoint JSON simple para esto.
export async function uploadDriveFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  contentBase64: string,
): Promise<{ id: string; webViewLink: string | null }> {
  const boundary = `drvbndry${Math.random().toString(16).slice(2)}`;
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${contentBase64}\r\n` +
    `--${boundary}--`;
  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Google Drive respondió ${response.status} al subir el archivo.`);
  }
  return payload as { id: string; webViewLink: string | null };
}

type SqlClient = ReturnType<typeof import('@neondatabase/serverless').neon>;

export type DriveCopyLogEntry = {
  path: string;
  name: string;
  type: 'folder' | 'file';
  mimeType: string;
  status: 'copied' | 'skipped' | 'error';
};

export type DriveCopySummary = { copiedFiles: number; skippedFiles: number; createdFolders: number; reusedFolders: number; errors: number };

export function emptyDriveCopySummary(): DriveCopySummary {
  return { copiedFiles: 0, skippedFiles: 0, createdFolders: 0, reusedFolders: 0, errors: 0 };
}

// En vez de acumular cada archivo/carpeta en un arreglo compartido que
// crece sin límite y se reenvía entero en cada invocación (lo que colapsaba
// con una sola carpeta de origen que tuviera miles de archivos directos),
// cada item de origen queda como su propia fila en drive_copy_items. La
// cola entre invocaciones solo necesita guardar qué CARPETAS faltan por
// listar (fase de escaneo) -- mucho más liviano.
export type DriveScanQueueItem = { sourceId: string; parentItemId: number | null; relativePath: string };

export function initialDriveScanQueue(sourceRootId: string): DriveScanQueueItem[] {
  return [{ sourceId: sourceRootId, parentItemId: null, relativePath: '' }];
}

// Fase 1 (barrido inicial): solo lista el árbol de origen y lo vuelca como
// filas "pending" en drive_copy_items -- no copia nada todavía. Mucho más
// rápido que la copia real, pero igual se trocea por si el árbol tiene
// muchísimas carpetas.
export async function scanDriveTreeChunk(
  sql: SqlClient,
  accessToken: string,
  jobId: string,
  scanQueue: DriveScanQueueItem[],
  deadline: number,
): Promise<{ scanQueue: DriveScanQueueItem[]; done: boolean }> {
  while (scanQueue.length) {
    if (Date.now() > deadline) return { scanQueue, done: false };
    const current = scanQueue.shift()!;

    const source = await driveRequest<DriveFile>(accessToken, `/files/${current.sourceId}?fields=id,name,mimeType&supportsAllDrives=true`);
    const relativePath = current.relativePath ? `${current.relativePath}/${source.name}` : source.name;
    const isFolder = source.mimeType === 'application/vnd.google-apps.folder';

    const [row] = (await sql`
      INSERT INTO drive_copy_items (job_id, source_id, parent_item_id, is_folder, name, mime_type, relative_path)
      VALUES (${jobId}, ${current.sourceId}, ${current.parentItemId}, ${isFolder}, ${source.name}, ${source.mimeType}, ${relativePath})
      RETURNING item_id AS id
    `) as any[];
    const itemId = Number(row.id);

    if (isFolder) {
      const children = await listDriveChildren(accessToken, current.sourceId);
      for (const child of children) {
        scanQueue.push({ sourceId: child.id, parentItemId: itemId, relativePath });
      }
    }
  }
  return { scanQueue, done: true };
}

const COPY_BATCH_SELECT_SIZE = 25;

// Fase 2 (copia por lotes): toma filas "pending" cuyo padre ya se resolvió
// en destino (o que son la raíz), las procesa, y repite hasta vaciar lo
// disponible o toparse con `deadline`/cancelación. Si algo se rompe a
// mitad de camino, lo único que se pierde es el lote en curso -- la
// siguiente invocación retoma consultando qué filas siguen "pending", sin
// necesidad de reconstruir ni reenviar nada.
export async function copyDriveItemsBatch(
  sql: SqlClient,
  accessToken: string,
  jobId: string,
  destinationRootId: string,
  summary: DriveCopySummary,
  deadline: number,
  isCancelled: () => boolean = () => false,
): Promise<{ summary: DriveCopySummary; done: boolean; cancelled: boolean }> {
  const destChildrenCache = new Map<string, DriveFile[]>();
  const getDestChildren = async (destFolderId: string): Promise<DriveFile[]> => {
    const cached = destChildrenCache.get(destFolderId);
    if (cached) return cached;
    const children = await listDriveChildren(accessToken, destFolderId);
    destChildrenCache.set(destFolderId, children);
    return children;
  };

  while (true) {
    if (isCancelled()) return { summary, done: false, cancelled: true };
    if (Date.now() > deadline) return { summary, done: false, cancelled: false };

    const items = (await sql`
      SELECT ci.item_id AS id, ci.source_id AS "sourceId", ci.parent_item_id AS "parentItemId",
        ci.is_folder AS "isFolder", ci.name, ci.mime_type AS "mimeType", parent.dest_id AS "parentDestId"
      FROM drive_copy_items ci
      LEFT JOIN drive_copy_items parent ON parent.item_id = ci.parent_item_id
      WHERE ci.job_id = ${jobId} AND ci.status = 'pending'
        AND (ci.parent_item_id IS NULL OR parent.status = 'copied')
      ORDER BY ci.is_folder DESC, ci.item_id ASC
      LIMIT ${COPY_BATCH_SELECT_SIZE}
    `) as any[];

    if (items.length === 0) {
      // Si no quedan filas "pending" en absoluto, terminamos de verdad. Si
      // quedan pero ninguna es elegible, es porque su carpeta padre falló
      // (quedó en 'error') y jamás van a quedar "listas" -- se marcan como
      // bloqueadas en vez de girar en vacío para siempre.
      const [{ pendingCount }] = (await sql`
        SELECT COUNT(*) AS "pendingCount" FROM drive_copy_items WHERE job_id = ${jobId} AND status = 'pending'
      `) as any[];
      if (Number(pendingCount) > 0) {
        const blocked = (await sql`
          UPDATE drive_copy_items SET status = 'error', error_message = 'La carpeta superior no se pudo copiar.', updated_at = NOW()
          WHERE job_id = ${jobId} AND status = 'pending'
          RETURNING item_id
        `) as any[];
        summary.errors += blocked.length;
      }
      return { summary, done: true, cancelled: false };
    }

    for (const item of items) {
      if (isCancelled()) return { summary, done: false, cancelled: true };
      if (Date.now() > deadline) return { summary, done: false, cancelled: false };

      const destParentId: string = item.parentItemId === null ? destinationRootId : item.parentDestId;
      try {
        if (item.isFolder) {
          const siblings = await getDestChildren(destParentId);
          const existing = siblings.find((f) => f.name === item.name && f.mimeType === 'application/vnd.google-apps.folder');
          const destFolder = existing ?? (await driveRequest<DriveFile>(accessToken, '/files?supportsAllDrives=true', {
            method: 'POST',
            body: JSON.stringify({ name: item.name, mimeType: 'application/vnd.google-apps.folder', parents: [destParentId] }),
          }));
          if (existing) summary.reusedFolders++;
          else summary.createdFolders++;
          await sql`UPDATE drive_copy_items SET status = 'copied', dest_id = ${destFolder.id}, updated_at = NOW() WHERE item_id = ${item.id}`;
        } else {
          const siblings = await getDestChildren(destParentId);
          const existing = siblings.find((f) => f.name === item.name && f.mimeType === item.mimeType);
          if (existing) {
            summary.skippedFiles++;
            await sql`UPDATE drive_copy_items SET status = 'skipped', dest_id = ${existing.id}, updated_at = NOW() WHERE item_id = ${item.id}`;
          } else {
            const copied = await driveRequest<DriveFile>(accessToken, `/files/${item.sourceId}/copy?supportsAllDrives=true`, {
              method: 'POST',
              body: JSON.stringify({ name: item.name, parents: [destParentId] }),
            });
            summary.copiedFiles++;
            await sql`UPDATE drive_copy_items SET status = 'copied', dest_id = ${copied.id}, updated_at = NOW() WHERE item_id = ${item.id}`;
          }
        }
      } catch (error) {
        summary.errors++;
        await sql`
          UPDATE drive_copy_items SET status = 'error', error_message = ${error instanceof Error ? error.message : String(error)}, updated_at = NOW()
          WHERE item_id = ${item.id}
        `;
      }
    }
  }
}
