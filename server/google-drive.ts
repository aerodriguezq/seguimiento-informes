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
  try {
    const token = await client.getAccessToken();
    if (!token.token) throw new Error('La sesión de Google Drive expiró.');
    return token.token;
  } catch (error) {
    // invalid_grant es el error estándar de OAuth cuando el refresh token ya
    // no sirve -- se revocó el acceso, se cambió la contraseña de esa
    // cuenta, o Google lo invalidó por inactividad. No hay nada que
    // reintentar: hay que reconectar la cuenta desde Fuentes Drive.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('invalid_grant')) {
      throw new Error('La conexión con esa cuenta de Google ya no es válida (se revocó el acceso o cambió la contraseña). Vuelve a conectarla desde Fuentes Drive.');
    }
    throw error;
  }
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
  errorMessage?: string | null;
};

export type DriveCopySummary = { copiedFiles: number; skippedFiles: number; createdFolders: number; reusedFolders: number; errors: number };

export function emptyDriveCopySummary(): DriveCopySummary {
  return { copiedFiles: 0, skippedFiles: 0, createdFolders: 0, reusedFolders: 0, errors: 0 };
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Trae metadatos de un solo archivo/carpeta de origen -- se usa una vez,
// para sembrar la fila raíz del job antes de arrancar a copiar.
export async function getDriveFileMeta(accessToken: string, fileId: string): Promise<DriveFile> {
  return driveRequest<DriveFile>(accessToken, `/files/${fileId}?fields=id,name,mimeType&supportsAllDrives=true`);
}

// Siembra la fila raíz (sin padre) de la que arranca todo el copiado.
export async function seedDriveCopyRoot(sql: SqlClient, jobId: string, accessToken: string, sourceRootId: string): Promise<void> {
  const source = await getDriveFileMeta(accessToken, sourceRootId);
  const isFolder = source.mimeType === FOLDER_MIME;
  await sql`
    INSERT INTO drive_copy_items (job_id, source_id, parent_item_id, is_folder, name, mime_type, relative_path)
    VALUES (${jobId}, ${sourceRootId}, NULL, ${isFolder}, ${source.name}, ${source.mimeType}, ${source.name})
  `;
}

const COPY_BATCH_SELECT_SIZE = 25;

export type DriveCopyRecentItem = { name: string; relativePath: string; isFolder: boolean; status: 'copied' | 'skipped' | 'error'; errorMessage?: string };

// Copia Y descubre en el mismo paso -- nunca lee el árbol completo de
// origen por adelantado. Cada vez que resuelve una carpeta, de una vez
// lista y encola sus hijos directos, así que el primer archivo se copia
// apenas se conoce, sin esperar a saber cuántos hay en total. Toma filas
// "pending" cuyo padre ya se resolvió en destino (o que son la raíz), las
// procesa, y repite hasta vaciar lo disponible o toparse con
// `deadline`/cancelación. Si algo se rompe a mitad de camino, lo único que
// se pierde es el lote en curso -- la siguiente invocación retoma
// consultando qué filas siguen "pending", sin reconstruir ni reenviar nada.
export async function copyDriveItemsBatch(
  sql: SqlClient,
  accessToken: string,
  jobId: string,
  destinationRootId: string,
  summary: DriveCopySummary,
  deadline: number,
  isCancelled: () => boolean = () => false,
): Promise<{ summary: DriveCopySummary; done: boolean; cancelled: boolean; recentItems: DriveCopyRecentItem[] }> {
  const destChildrenCache = new Map<string, DriveFile[]>();
  const getDestChildren = async (destFolderId: string): Promise<DriveFile[]> => {
    const cached = destChildrenCache.get(destFolderId);
    if (cached) return cached;
    const children = await listDriveChildren(accessToken, destFolderId);
    destChildrenCache.set(destFolderId, children);
    return children;
  };

  // Los items que esta invocación procesó -- el llamador los agrega a un
  // log en vivo que se ve crecer en pantalla a medida que corre, en vez de
  // solo un contador que avanza sin explicar qué está copiando.
  const recentItems: DriveCopyRecentItem[] = [];

  while (true) {
    if (isCancelled()) return { summary, done: false, cancelled: true, recentItems };
    if (Date.now() > deadline) return { summary, done: false, cancelled: false, recentItems };

    const items = (await sql`
      SELECT ci.item_id AS id, ci.source_id AS "sourceId", ci.parent_item_id AS "parentItemId",
        ci.is_folder AS "isFolder", ci.name, ci.mime_type AS "mimeType", ci.relative_path AS "relativePath",
        parent.dest_id AS "parentDestId"
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
          RETURNING item_id, name, relative_path AS "relativePath", is_folder AS "isFolder"
        `) as any[];
        summary.errors += blocked.length;
        for (const row of blocked) {
          recentItems.push({ name: row.name, relativePath: row.relativePath, isFolder: !!row.isFolder, status: 'error', errorMessage: 'La carpeta superior no se pudo copiar.' });
        }
      }
      return { summary, done: true, cancelled: false, recentItems };
    }

    for (const item of items) {
      if (isCancelled()) return { summary, done: false, cancelled: true, recentItems };
      if (Date.now() > deadline) return { summary, done: false, cancelled: false, recentItems };

      const destParentId: string = item.parentItemId === null ? destinationRootId : item.parentDestId;
      try {
        if (item.isFolder) {
          const siblings = await getDestChildren(destParentId);
          const existing = siblings.find((f) => f.name === item.name && f.mimeType === FOLDER_MIME);
          const destFolder = existing ?? (await driveRequest<DriveFile>(accessToken, '/files?supportsAllDrives=true', {
            method: 'POST',
            body: JSON.stringify({ name: item.name, mimeType: FOLDER_MIME, parents: [destParentId] }),
          }));
          if (existing) summary.reusedFolders++;
          else summary.createdFolders++;
          await sql`UPDATE drive_copy_items SET status = 'copied', dest_id = ${destFolder.id}, updated_at = NOW() WHERE item_id = ${item.id}`;
          recentItems.push({ name: item.name, relativePath: item.relativePath, isFolder: true, status: 'copied' });

          // Recién ahora que la carpeta quedó resuelta en destino se listan
          // sus hijos y se encolan como filas "pending" -- el descubrimiento
          // avanza al mismo ritmo que la copia, nunca por adelantado. Esto va
          // en su propio try/catch: si falla, la carpeta YA quedó copiada (no
          // hay que deshacer eso) -- solo se deja constancia de que no se
          // pudo ver su contenido, sin tocar el estado 'copied' de la fila
          // original.
          try {
            const sourceChildren = await listDriveChildren(accessToken, item.sourceId);
            if (sourceChildren.length > 0) {
              // Una sola ida y vuelta a la base para todos los hijos de esta
              // carpeta -- antes era un INSERT por hijo, y una carpeta con
              // cientos de archivos directos por sí sola podía agotar el
              // tiempo de la invocación antes de terminar de encolarlos.
              const rows = sourceChildren.map((child) => ({
                source_id: child.id,
                parent_item_id: item.id,
                is_folder: child.mimeType === FOLDER_MIME,
                name: child.name,
                mime_type: child.mimeType,
                relative_path: `${item.relativePath}/${child.name}`,
              }));
              await sql`
                INSERT INTO drive_copy_items (job_id, source_id, parent_item_id, is_folder, name, mime_type, relative_path)
                SELECT ${jobId}, r.source_id, r.parent_item_id, r.is_folder, r.name, r.mime_type, r.relative_path
                FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
                  AS r(source_id text, parent_item_id bigint, is_folder boolean, name text, mime_type text, relative_path text)
              `;
            }
          } catch (discoveryError) {
            const errorMessage = discoveryError instanceof Error ? discoveryError.message : String(discoveryError);
            summary.errors++;
            await sql`
              INSERT INTO drive_copy_items (job_id, source_id, parent_item_id, is_folder, name, mime_type, relative_path, status, error_message)
              VALUES (${jobId}, ${item.sourceId}, ${item.parentItemId}, true, ${item.name}, ${item.mimeType}, ${item.relativePath}, 'error', ${`No se pudo listar su contenido: ${errorMessage}`})
            `;
            recentItems.push({ name: item.name, relativePath: item.relativePath, isFolder: true, status: 'error', errorMessage: `No se pudo listar su contenido: ${errorMessage}` });
          }
        } else {
          const siblings = await getDestChildren(destParentId);
          const existing = siblings.find((f) => f.name === item.name && f.mimeType === item.mimeType);
          if (existing) {
            summary.skippedFiles++;
            await sql`UPDATE drive_copy_items SET status = 'skipped', dest_id = ${existing.id}, updated_at = NOW() WHERE item_id = ${item.id}`;
            recentItems.push({ name: item.name, relativePath: item.relativePath, isFolder: false, status: 'skipped' });
          } else {
            const copied = await driveRequest<DriveFile>(accessToken, `/files/${item.sourceId}/copy?supportsAllDrives=true`, {
              method: 'POST',
              body: JSON.stringify({ name: item.name, parents: [destParentId] }),
            });
            summary.copiedFiles++;
            await sql`UPDATE drive_copy_items SET status = 'copied', dest_id = ${copied.id}, updated_at = NOW() WHERE item_id = ${item.id}`;
            recentItems.push({ name: item.name, relativePath: item.relativePath, isFolder: false, status: 'copied' });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        summary.errors++;
        await sql`
          UPDATE drive_copy_items SET status = 'error', error_message = ${errorMessage}, updated_at = NOW()
          WHERE item_id = ${item.id}
        `;
        recentItems.push({ name: item.name, relativePath: item.relativePath, isFolder: !!item.isFolder, status: 'error', errorMessage });
      }
    }
  }
}
