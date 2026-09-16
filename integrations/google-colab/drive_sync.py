"""Ejemplo para Google Colab.

No contiene credenciales. Configura APP_URL y APP_SCRIPT_SHARED_SECRET como
variables de entorno o secretos de Colab antes de ejecutarlo.
"""

import os
import requests


APP_URL = os.environ["APP_URL"].rstrip("/")
SHARED_SECRET = os.environ["APP_SCRIPT_SHARED_SECRET"]


def get_drive_links() -> dict:
    response = requests.get(
        f"{APP_URL}/api/drive-links",
        headers={"Authorization": f"Bearer {SHARED_SECRET}"},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("errors"):
        raise RuntimeError(payload["errors"])
    return payload["data"]


links = get_drive_links()
print("Origen:", links["sourceUrl"])
print("Destino:", links["destinationUrl"])

# Desde aquí puedes usar PyDrive2 o la API de Drive autorizada en Colab.
# La autenticación de Google debe vivir en Colab, nunca en el frontend.