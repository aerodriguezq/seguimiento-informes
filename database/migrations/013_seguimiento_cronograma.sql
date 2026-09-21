CREATE TABLE IF NOT EXISTS seguimiento_config (
  proyecto_id INTEGER PRIMARY KEY REFERENCES proyectos(proyecto_id),
  spreadsheet_id TEXT NOT NULL,
  cronograma_gid TEXT NOT NULL,
  ultima_importacion TIMESTAMPTZ,
  ultimo_error TEXT
);

CREATE TABLE IF NOT EXISTS seguimiento_cronograma_filas (
  fila_id SERIAL PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(proyecto_id),
  orden INTEGER NOT NULL DEFAULT 0,
  sub_actividad TEXT NOT NULL DEFAULT '',
  concepto TEXT NOT NULL DEFAULT '',
  total_toneladas NUMERIC,
  toneladas_riego_abono NUMERIC,
  observaciones TEXT NOT NULL DEFAULT '',
  es_resumen BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_cronograma_filas_proyecto ON seguimiento_cronograma_filas (proyecto_id);

CREATE TABLE IF NOT EXISTS seguimiento_cronograma_segmentos (
  segmento_id SERIAL PRIMARY KEY,
  fila_id INTEGER NOT NULL REFERENCES seguimiento_cronograma_filas(fila_id) ON DELETE CASCADE,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  color TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cronograma_segmentos_fila ON seguimiento_cronograma_segmentos (fila_id);

-- Configuracion inicial para el proyecto Montes de Maria (BPIN 20241301010155).
INSERT INTO seguimiento_config (proyecto_id, spreadsheet_id, cronograma_gid)
SELECT proyecto_id, '1YUj5z_VK_4ZQ52KSqEPVQak-ZPpNuVIwQVEmrAd0uXo', '1708932587'
FROM proyectos WHERE bpin = '20241301010155'
ON CONFLICT (proyecto_id) DO UPDATE SET spreadsheet_id = EXCLUDED.spreadsheet_id, cronograma_gid = EXCLUDED.cronograma_gid;
