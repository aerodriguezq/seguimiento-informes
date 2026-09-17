-- Las evidencias ahora se vinculan a un archivo real de Google Drive en vez
-- de simular una subida de archivo sin almacenamiento real.
ALTER TABLE informe_adjuntos ADD COLUMN IF NOT EXISTS drive_url TEXT;
