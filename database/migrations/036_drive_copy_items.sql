-- Rediseño de la copia de carpetas de Drive: antes el progreso vivía en dos
-- arreglos JSONB ("queue" y "log") dentro de una sola fila de
-- drive_copy_jobs, que crecían sin límite -- una sola carpeta de origen con
-- miles de archivos directos metía esos miles de items en el arreglo de una
-- sola vez, y ese arreglo entero se serializaba y reenviaba en cada
-- invocación. Eso es lo que colapsaba con carpetas grandes.
--
-- Ahora cada archivo/carpeta de origen es su propia fila en
-- drive_copy_items, consultable y actualizable una por una. Reanudar tras
-- un corte es trivial: basta con seguir pidiendo las filas "pending".
ALTER TABLE drive_copy_jobs ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'done';
ALTER TABLE drive_copy_jobs ADD COLUMN IF NOT EXISTS scan_queue JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE drive_copy_jobs ADD COLUMN IF NOT EXISTS source_root_id TEXT;
ALTER TABLE drive_copy_jobs ADD COLUMN IF NOT EXISTS destination_root_id TEXT;

CREATE TABLE IF NOT EXISTS drive_copy_items (
  item_id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES drive_copy_jobs(job_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  parent_item_id BIGINT REFERENCES drive_copy_items(item_id) ON DELETE CASCADE,
  is_folder BOOLEAN NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  dest_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drive_copy_items_job_status ON drive_copy_items (job_id, status);
CREATE INDEX IF NOT EXISTS idx_drive_copy_items_parent ON drive_copy_items (parent_item_id);
