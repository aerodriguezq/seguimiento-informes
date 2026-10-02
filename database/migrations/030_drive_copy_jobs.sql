-- Copias de carpetas de Drive grandes (cuenta conectada) ya no corren en
-- una sola invocación serverless de hasta 60s: se trocean, guardando la
-- cola pendiente y el progreso aquí entre invocaciones, para poder
-- retomar la copia exactamente donde quedó.
CREATE TABLE IF NOT EXISTS drive_copy_jobs (
  job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',
  queue JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB NOT NULL DEFAULT '{"copiedFiles":0,"skippedFiles":0,"createdFolders":0,"reusedFolders":0}'::jsonb,
  log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drive_copy_jobs_status ON drive_copy_jobs (status);
