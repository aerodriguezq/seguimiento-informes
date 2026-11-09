ALTER TABLE seguimiento_config ADD COLUMN IF NOT EXISTS informe_id BIGINT REFERENCES informes(informe_id);
