-- Referencia SubActividad-Linea: conecta el mundo "Subactividad" (Cronograma)
-- con el mundo "Linea Productiva" (Abono, Material Vegetal, Entrega Insumos,
-- Insumos Detalle).
CREATE TABLE IF NOT EXISTS seguimiento_referencia_lineas (
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(proyecto_id),
  sub_actividad TEXT NOT NULL,
  linea_productiva TEXT NOT NULL,
  PRIMARY KEY (proyecto_id, sub_actividad)
);

-- Una fila por (proyecto, linea productiva, pista). "pista" es una de:
-- proveeduria_compra, proveeduria_entrega, entrega_abono,
-- entrega_material_vegetal, entrega_insumos.
CREATE TABLE IF NOT EXISTS seguimiento_linea_pistas (
  pista_id SERIAL PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(proyecto_id),
  linea_productiva TEXT NOT NULL,
  pista TEXT NOT NULL,
  fecha_inicio DATE,
  fecha_fin DATE,
  cantidad_total INTEGER NOT NULL DEFAULT 0,
  cantidad_entregada INTEGER NOT NULL DEFAULT 0,
  toneladas_total NUMERIC,
  hectareas NUMERIC,
  UNIQUE (proyecto_id, linea_productiva, pista)
);

CREATE INDEX IF NOT EXISTS idx_linea_pistas_proyecto ON seguimiento_linea_pistas (proyecto_id);

-- Entrega Estimada Manual: una fila por Subactividad (no por linea).
CREATE TABLE IF NOT EXISTS seguimiento_proyeccion (
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(proyecto_id),
  sub_actividad TEXT NOT NULL,
  fecha_inicio DATE,
  fecha_fin DATE,
  dias_entrega NUMERIC,
  beneficiarios_por_dia NUMERIC,
  total_toneladas_kit NUMERIC,
  PRIMARY KEY (proyecto_id, sub_actividad)
);

-- Las 3 tarjetas de % de avance de arriba. Solo agregados (conteos), nunca
-- datos personales de beneficiarios.
CREATE TABLE IF NOT EXISTS seguimiento_kpis (
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(proyecto_id),
  tipo TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  avance INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (proyecto_id, tipo)
);
