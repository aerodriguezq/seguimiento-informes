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

export type DriveCopyLogEntry = {
  path: string;
  name: string;
  type: 'folder' | 'file';
  mimeType: string;
  status: 'copied' | 'skipped' | 'created_folder' | 'reused_folder';
};

export type DriveCopySummary = { copiedFiles: number; skippedFiles: number; createdFolders: number; reusedFolders: number };

// Una carpeta se procesa primero (lista sus hijos y crea/reutiliza la
// carpeta destino); cada hijo (subcarpeta o archivo) se encola como su
// propio item -- así cada vuelta del while de copyDriveTreeChunk hace un
// único trabajo (una llamada a Drive como mucho), lo que permite cortar la
// copia en cualquier punto, incluso a mitad de una carpeta con miles de
// archivos, y retomarla exactamente donde quedó en la siguiente invocación.
export type DriveCopyQueueItem =
  | { kind: 'folder'; sourceId: string; destinationParentId: string; parentPath: string }
  | { kind: 'file'; sourceFileId: string; name: string; mimeType: string; destinationFolderId: string; folderPath: string; alreadyExists: boolean };

export function initialDriveCopyQueue(sourceId: string, destinationParentId: string): DriveCopyQueueItem[] {
  return [{ kind: 'folder', sourceId, destinationParentId, parentPath: '' }];
}

export function emptyDriveCopySummary(): DriveCopySummary {
  return { copiedFiles: 0, skippedFiles: 0, createdFolders: 0, reusedFolders: 0 };
}

// Procesa items de la cola hasta vaciarla, hasta `deadline` (ms epoch) o
// hasta que isCancelled() devuelva true -- lo que ocurra primero. El
// llamador persiste `queue`/`summary`/`log` entre llamadas (una fila en
// drive_copy_jobs) para poder reanudar en una invocación posterior cuando
// la copia no cabe en el límite de tiempo de una función serverless.
export async function copyDriveTreeChunk(
  accessToken: string,
  queue: DriveCopyQueueItem[],
  summary: DriveCopySummary,
  log: DriveCopyLogEntry[],
  deadline: number,
  isCancelled: () => boolean = () => false,
): Promise<{ queue: DriveCopyQueueItem[]; summary: DriveCopySummary; log: DriveCopyLogEntry[]; done: boolean; cancelled: boolean }> {
  while (queue.length) {
    if (isCancelled()) return { queue, summary, log, done: false, cancelled: true };
    if (Date.now() > deadline) return { queue, summary, log, done: false, cancelled: false };
    const item = queue.shift()!;

    if (item.kind === 'folder') {
      const source = await driveRequest<DriveFile>(accessToken, `/files/${item.sourceId}?fields=id,name,mimeType&supportsAllDrives=true`);
      const folderPath = item.parentPath ? `${item.parentPath}/${source.name}` : source.name;
      const destinationItems = await listDriveChildren(accessToken, item.destinationParentId);
      const existingFolder = destinationItems.find((file) => file.name === source.name && file.mimeType === 'application/vnd.google-apps.folder');
      const destinationFolderId = existingFolder?.id ?? (await driveRequest<DriveFile>(accessToken, '/files?supportsAllDrives=true', {
        method: 'POST',
        body: JSON.stringify({ name: source.name, mimeType: 'application/vnd.google-apps.folder', parents: [item.destinationParentId] }),
      })).id;

      if (existingFolder) summary.reusedFolders++;
      else summary.createdFolders++;
      log.push({
        path: folderPath,
        name: source.name,
        type: 'folder',
        mimeType: source.mimeType,
        status: existingFolder ? 'reused_folder' : 'created_folder',
      });

      const sourceItems = await listDriveChildren(accessToken, item.sourceId);
      for (const file of sourceItems) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          queue.push({ kind: 'folder', sourceId: file.id, destinationParentId: destinationFolderId, parentPath: folderPath });
        } else {
          const alreadyExists = destinationItems.some((existing) => existing.name === file.name && existing.mimeType === file.mimeType);
          queue.push({ kind: 'file', sourceFileId: file.id, name: file.name, mimeType: file.mimeType, destinationFolderId, folderPath, alreadyExists });
        }
      }
    } else if (item.alreadyExists) {
      summary.skippedFiles++;
      log.push({ path: `${item.folderPath}/${item.name}`, name: item.name, type: 'file', mimeType: item.mimeType, status: 'skipped' });
    } else {
      await driveRequest<DriveFile>(accessToken, `/files/${item.sourceFileId}/copy?supportsAllDrives=true`, {
        method: 'POST',
        body: JSON.stringify({ name: item.name, parents: [item.destinationFolderId] }),
      });
      summary.copiedFiles++;
      log.push({ path: `${item.folderPath}/${item.name}`, name: item.name, type: 'file', mimeType: item.mimeType, status: 'copied' });
    }
  }

  return { queue, summary, log, done: true, cancelled: false };
}
