-- Cada proyecto puede tener una carpeta de Drive vinculada para Seguimiento,
-- independiente de si ya tiene una hoja de cálculo de cronograma vinculada.
-- Se relajan spreadsheet_id/cronograma_gid a NULL porque ahora puede existir
-- una fila de seguimiento_config solo con la carpeta de Drive, sin hoja aún.
ALTER TABLE seguimiento_config ALTER COLUMN spreadsheet_id DROP NOT NULL;
ALTER TABLE seguimiento_config ALTER COLUMN cronograma_gid DROP NOT NULL;
ALTER TABLE seguimiento_config ADD COLUMN IF NOT EXISTS drive_folder_url TEXT;
