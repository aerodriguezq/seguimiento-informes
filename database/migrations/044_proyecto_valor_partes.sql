-- Subdivisión manual del Valor del Proyecto en N partes por monto (plan de
-- desembolsos): número/etiqueta, concepto, monto, fecha estimada y estado
-- (Pendiente/Pagado). Independiente de los informes reales de tipo
-- "Desembolso" -- esto es la planeación de cómo se reparte el valor del
-- contrato, no un registro de lo ya radicado.
CREATE TABLE IF NOT EXISTS proyecto_valor_partes (
  parte_id SERIAL PRIMARY KEY,
  proyecto_id BIGINT NOT NULL REFERENCES proyectos(proyecto_id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  concepto TEXT,
  monto NUMERIC NOT NULL,
  fecha_estimada DATE,
  estado TEXT NOT NULL DEFAULT 'Pendiente',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proyecto_valor_partes_proyecto ON proyecto_valor_partes (proyecto_id, fecha_estimada);
