-- Los pasos del flujo de entrega ahora pueden depender del proyecto, no
-- solo del tipo de informe. proyecto_id = NULL sigue siendo la "plantilla
-- general" (lo que ya existe hoy, sin romper nada); un proyecto con sus
-- propios pasos configurados (proyecto_id especifico) usa ESOS en vez de
-- la plantilla general.
ALTER TABLE tipo_informe_pasos ADD COLUMN IF NOT EXISTS proyecto_id BIGINT REFERENCES proyectos(proyecto_id);

-- La unicidad de "orden" pasa a ser por (proyecto_id, tipo_informe_id,
-- orden) en vez de solo (tipo_informe_id, orden) -- se usa un indice por
-- expresion (COALESCE a -1) porque NULL no se compara igual a NULL en una
-- UNIQUE constraint normal, y aqui sí queremos que solo pueda existir una
-- plantilla general con un "orden" dado por tipo de informe.
ALTER TABLE tipo_informe_pasos DROP CONSTRAINT IF EXISTS tipo_informe_pasos_tipo_informe_id_orden_key;
CREATE UNIQUE INDEX IF NOT EXISTS tipo_informe_pasos_proyecto_tipo_orden_key
  ON tipo_informe_pasos (COALESCE(proyecto_id, -1), tipo_informe_id, orden);

CREATE INDEX IF NOT EXISTS idx_tipo_informe_pasos_proyecto ON tipo_informe_pasos (proyecto_id, tipo_informe_id);
