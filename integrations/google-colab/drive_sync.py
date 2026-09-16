"""Copia una carpeta completa de Google Drive desde Google Colab.

Neon mantiene los enlaces de origen y destino. Colab autentica directamente
con la cuenta Google del usuario, por lo que no depende de un Web App público
de Apps Script.
"""

import os
import re
from collections import deque

import requests


APP_URL = os.getenv("APP_URL", "https://seguimiento-informes.vercel.app").rstrip("/")


def get_secret(name: str) -> str:
    """Lee un secreto de Colab Secrets o de variables de entorno."""
    try:
        from google.colab import userdata

        value = userdata.get(name)
        if value:
            return value.strip()
    except (ImportError, KeyError):
        pass

    value = os.getenv(name)
    if value:
        return value.strip()

    raise RuntimeError(f"Falta configurar {name} en Colab Secrets.")


def get_drive_links() -> dict:
    response = requests.get(
        f"{APP_URL}/api/drive-links",
        headers={"Authorization": f"Bearer {get_secret('APP_SCRIPT_SHARED_SECRET')}"},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("errors"):
        raise RuntimeError(payload["errors"])
    return payload["data"]


def folder_id_from_url(url: str) -> str:
    match = re.search(r"/folders/([\w-]+)", url)
    if not match:
        raise ValueError(f"No se encontró un ID de carpeta en: {url}")
    return match.group(1)


def authenticate_drive():
    """Solicita autorización Drive en la cuenta activa de Colab."""
    from google.colab import auth
    from googleapiclient.discovery import build

    auth.authenticate_user()
    return build("drive", "v3")


def list_children(drive, folder_id: str) -> list[dict]:
    children = []
    page_token = None
    while True:
        result = drive.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            fields="nextPageToken, files(id, name, mimeType)",
            pageSize=1000,
            pageToken=page_token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        children.extend(result.get("files", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            return children


def find_or_create_folder(drive, parent_id: str, name: str, cache: dict) -> tuple[str, bool]:
    cache_key = (parent_id, name)
    if cache_key in cache:
        return cache[cache_key], True

    existing = next(
        (item for item in list_children(drive, parent_id)
         if item["name"] == name and item["mimeType"] == "application/vnd.google-apps.folder"),
        None,
    )
    if existing:
        cache[cache_key] = existing["id"]
        return existing["id"], True

    created = drive.files().create(
        body={
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        },
        fields="id",
        supportsAllDrives=True,
    ).execute()
    cache[cache_key] = created["id"]
    return created["id"], False


def copy_folder_tree(drive, source_id: str, destination_parent_id: str) -> dict:
    queue = deque([(source_id, destination_parent_id)])
    folder_cache = {}
    copied_files = 0
    skipped_files = 0
    created_folders = 0
    reused_folders = 0
    processed = 0

    while queue:
        current_source_id, current_destination_parent_id = queue.popleft()
        source_metadata = drive.files().get(
            fileId=current_source_id,
            fields="id, name, mimeType",
            supportsAllDrives=True,
        ).execute()
        current_destination_id, reused = find_or_create_folder(
            drive, current_destination_parent_id, source_metadata["name"], folder_cache
        )
        if reused:
            reused_folders += 1
        else:
            created_folders += 1

        destination_items = {
            (item["name"], item["mimeType"]): item["id"]
            for item in list_children(drive, current_destination_id)
        }
        for item in list_children(drive, current_source_id):
            key = (item["name"], item["mimeType"])
            if item["mimeType"] == "application/vnd.google-apps.folder":
                queue.append((item["id"], current_destination_id))
            elif key in destination_items:
                skipped_files += 1
            else:
                drive.files().copy(
                    fileId=item["id"],
                    body={"name": item["name"], "parents": [current_destination_id]},
                    supportsAllDrives=True,
                ).execute()
                copied_files += 1

        processed += 1
        print(
            f"Carpetas procesadas: {processed} | pendientes: {len(queue)} | "
            f"copiados: {copied_files} | omitidos: {skipped_files}",
            end="\r",
        )

    print()
    return {
        "copiedFiles": copied_files,
        "skippedFiles": skipped_files,
        "createdFolders": created_folders,
        "reusedFolders": reused_folders,
    }


def run_copy() -> dict:
    """Lee Neon, autentica Drive y copia origen completo en destino."""
    links = get_drive_links()
    print("Origen:", links["sourceUrl"])
    print("Destino:", links["destinationUrl"])
    drive = authenticate_drive()
    result = copy_folder_tree(
        drive,
        folder_id_from_url(links["sourceUrl"]),
        folder_id_from_url(links["destinationUrl"]),
    )
    print("Resultado:", result)
    return result


# En Colab ejecuta manualmente:
# result = run_copy()