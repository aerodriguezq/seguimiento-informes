-- Observaciones libres (se incluyen en los correos de la petición), y
-- documentos de petición/respuesta guardados en una subcarpeta de Drive
-- propia de cada petición (dentro de una carpeta raíz configurable).
ALTER TABLE peticiones ADD COLUMN IF NOT EXISTS observaciones TEXT NOT NULL DEFAULT '';
ALTER TABLE peticiones ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
ALTER TABLE peticiones ADD COLUMN IF NOT EXISTS drive_folder_url TEXT;
ALTER TABLE peticiones ADD COLUMN IF NOT EXISTS documento_peticion_nombre TEXT;
ALTER TABLE peticiones ADD COLUMN IF NOT EXISTS documento_peticion_drive_url TEXT;
ALTER TABLE peticiones ADD COLUMN IF NOT EXISTS documento_respuesta_nombre TEXT;
ALTER TABLE peticiones ADD COLUMN IF NOT EXISTS documento_respuesta_drive_url TEXT;

-- Carpeta raíz de Drive (configurada una sola vez por un admin, en
-- Peticiones) bajo la cual se crea una subcarpeta por cada radicado.
CREATE TABLE IF NOT EXISTS peticiones_config (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  drive_root_folder_id TEXT,
  drive_root_folder_url TEXT,
  CONSTRAINT peticiones_config_singleton CHECK (id = 1)
);
