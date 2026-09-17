import { getGoogleOAuthClient } from './google-oauth.js';

type DriveFile = { id: string; name: string; mimeType: string };

export async function getDriveAccessToken(tokenJson: string) {
  const client = await getGoogleOAuthClient();
  client.setCredentials(JSON.parse(tokenJson));
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('La sesión de Google Drive expiró.');
  return token.token;
}

async function driveRequest<T>(accessToken: string, path: string, options: RequestInit = {}) {
  const response = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || `Google Drive respondió ${response.status}.`);
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

export async function copyDriveTree(accessToken: string, sourceId: string, destinationParentId: string) {
  const queue: Array<{ sourceId: string; destinationParentId: string }> = [{ sourceId, destinationParentId }];
  const summary = { copiedFiles: 0, skippedFiles: 0, createdFolders: 0, reusedFolders: 0 };

  while (queue.length) {
    const item = queue.shift()!;
    const source = await driveRequest<DriveFile>(accessToken, `/files/${item.sourceId}?fields=id,name,mimeType&supportsAllDrives=true`);
    const destinationItems = await listDriveChildren(accessToken, item.destinationParentId);
    const existingFolder = destinationItems.find((file) => file.name === source.name && file.mimeType === 'application/vnd.google-apps.folder');
    const destinationFolderId = existingFolder?.id ?? (await driveRequest<DriveFile>(accessToken, '/files?supportsAllDrives=true', {
      method: 'POST',
      body: JSON.stringify({ name: source.name, mimeType: 'application/vnd.google-apps.folder', parents: [item.destinationParentId] }),
    })).id;

    if (existingFolder) summary.reusedFolders++;
    else summary.createdFolders++;

    const sourceItems = await listDriveChildren(accessToken, item.sourceId);
    for (const file of sourceItems) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        queue.push({ sourceId: file.id, destinationParentId: destinationFolderId });
      } else if (destinationItems.some((existing) => existing.name === file.name && existing.mimeType === file.mimeType)) {
        summary.skippedFiles++;
      } else {
        await driveRequest<DriveFile>(accessToken, `/files/${file.id}/copy?supportsAllDrives=true`, {
          method: 'POST',
          body: JSON.stringify({ name: file.name, parents: [destinationFolderId] }),
        });
        summary.copiedFiles++;
      }
    }
  }

  return summary;
}
