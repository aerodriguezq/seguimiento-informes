-- Un proyecto puede tener VARIAS hojas de Seguimiento con el mismo formato
-- (ej. varios contratos/fases bajo un mismo proyecto como San Jacinto) --
-- antes solo se podía vincular una por proyecto (proyecto_id era la llave
-- primaria de seguimiento_config, y cada tabla de datos quedaba scoped solo
-- por proyecto_id). Se introduce seguimiento_id como la llave real de "una
-- hoja configurada"; proyecto_id pasa a ser una referencia normal que puede
-- repetirse. Todo lo ya cargado (Montes de Maria) se reasigna a su propio
-- seguimiento_id en el backfill de abajo, sin perder nada.

ALTER TABLE seguimiento_config ADD COLUMN IF NOT EXISTS seguimiento_id SERIAL;
ALTER TABLE seguimiento_config ADD COLUMN IF NOT EXISTS nombre TEXT NOT NULL DEFAULT 'Principal';

ALTER TABLE seguimiento_config DROP CONSTRAINT IF EXISTS seguimiento_config_pkey;
ALTER TABLE seguimiento_config ADD CONSTRAINT seguimiento_config_pkey PRIMARY KEY (seguimiento_id);
CREATE INDEX IF NOT EXISTS idx_seguimiento_config_proyecto ON seguimiento_config (proyecto_id);

-- Agrega seguimiento_id a cada tabla de datos (nullable por ahora -- se
-- completa en el backfill de abajo y recién después queda como parte de la
-- llave real).
ALTER TABLE seguimiento_cronograma_filas ADD COLUMN IF NOT EXISTS seguimiento_id INTEGER REFERENCES seguimiento_config(seguimiento_id) ON DELETE CASCADE;
ALTER TABLE seguimiento_referencia_lineas ADD COLUMN IF NOT EXISTS seguimiento_id INTEGER REFERENCES seguimiento_config(seguimiento_id) ON DELETE CASCADE;
ALTER TABLE seguimiento_linea_pistas ADD COLUMN IF NOT EXISTS seguimiento_id INTEGER REFERENCES seguimiento_config(seguimiento_id) ON DELETE CASCADE;
ALTER TABLE seguimiento_proyeccion ADD COLUMN IF NOT EXISTS seguimiento_id INTEGER REFERENCES seguimiento_config(seguimiento_id) ON DELETE CASCADE;
ALTER TABLE seguimiento_kpis ADD COLUMN IF NOT EXISTS seguimiento_id INTEGER REFERENCES seguimiento_config(seguimiento_id) ON DELETE CASCADE;
ALTER TABLE seguimiento_insumos_detalle ADD COLUMN IF NOT EXISTS seguimiento_id INTEGER REFERENCES seguimiento_config(seguimiento_id) ON DELETE CASCADE;

-- Backfill: cada fila de datos existente hereda el seguimiento_id de la
-- (única, hasta ahora) config de su proyecto.
UPDATE seguimiento_cronograma_filas f SET seguimiento_id = sc.seguimiento_id
  FROM seguimiento_config sc WHERE sc.proyecto_id = f.proyecto_id AND f.seguimiento_id IS NULL;
UPDATE seguimiento_referencia_lineas f SET seguimiento_id = sc.seguimiento_id
  FROM seguimiento_config sc WHERE sc.proyecto_id = f.proyecto_id AND f.seguimiento_id IS NULL;
UPDATE seguimiento_linea_pistas f SET seguimiento_id = sc.seguimiento_id
  FROM seguimiento_config sc WHERE sc.proyecto_id = f.proyecto_id AND f.seguimiento_id IS NULL;
UPDATE seguimiento_proyeccion f SET seguimiento_id = sc.seguimiento_id
  FROM seguimiento_config sc WHERE sc.proyecto_id = f.proyecto_id AND f.seguimiento_id IS NULL;
UPDATE seguimiento_kpis f SET seguimiento_id = sc.seguimiento_id
  FROM seguimiento_config sc WHERE sc.proyecto_id = f.proyecto_id AND f.seguimiento_id IS NULL;
UPDATE seguimiento_insumos_detalle f SET seguimiento_id = sc.seguimiento_id
  FROM seguimiento_config sc WHERE sc.proyecto_id = f.proyecto_id AND f.seguimiento_id IS NULL;

-- Las llaves/uniques que antes eran (proyecto_id, x) pasan a (seguimiento_id, x)
-- -- ahora la unicidad es "por hoja", no "por proyecto".
ALTER TABLE seguimiento_referencia_lineas DROP CONSTRAINT IF EXISTS seguimiento_referencia_lineas_pkey;
ALTER TABLE seguimiento_referencia_lineas ADD PRIMARY KEY (seguimiento_id, sub_actividad);

ALTER TABLE seguimiento_proyeccion DROP CONSTRAINT IF EXISTS seguimiento_proyeccion_pkey;
ALTER TABLE seguimiento_proyeccion ADD PRIMARY KEY (seguimiento_id, sub_actividad);

ALTER TABLE seguimiento_kpis DROP CONSTRAINT IF EXISTS seguimiento_kpis_pkey;
ALTER TABLE seguimiento_kpis ADD PRIMARY KEY (seguimiento_id, tipo);

ALTER TABLE seguimiento_linea_pistas DROP CONSTRAINT IF EXISTS seguimiento_linea_pistas_proyecto_id_linea_productiva_pista_key;
ALTER TABLE seguimiento_linea_pistas ADD CONSTRAINT seguimiento_linea_pistas_seguimiento_linea_pista_key UNIQUE (seguimiento_id, linea_productiva, pista);

CREATE INDEX IF NOT EXISTS idx_cronograma_filas_seguimiento ON seguimiento_cronograma_filas (seguimiento_id);
CREATE INDEX IF NOT EXISTS idx_insumos_detalle_seguimiento_linea ON seguimiento_insumos_detalle (seguimiento_id, linea_productiva);
