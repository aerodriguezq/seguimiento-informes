-- San Jacinto usa un archivo "Gantt Físico-Financiero" con un formato
-- totalmente distinto al de Montes de Maria: Plan/Ejecutado MENSUAL por
-- subactividad (agrupadas por Actividad), sin pestañas de Insumos
-- Detalle/Abono/Material Vegetal/Beneficiarios -- esas simplemente no
-- existen en ese archivo. seguimiento_config.formato distingue cuál vista
-- usar ('detalle' = el dashboard de Insumos/Abono/Cronograma por día de
-- siempre, 'gantt_mensual' = el nuevo, agrupado por actividad con barras
-- Plan vs Ejecutado por mes, en versión física y financiera).

ALTER TABLE seguimiento_config ADD COLUMN IF NOT EXISTS formato TEXT NOT NULL DEFAULT 'detalle';

CREATE TABLE IF NOT EXISTS seguimiento_gantt_subactividades (
  id SERIAL PRIMARY KEY,
  seguimiento_id INTEGER NOT NULL REFERENCES seguimiento_config(seguimiento_id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  orden INTEGER NOT NULL,
  actividad TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  sub_actividad TEXT NOT NULL,
  meta NUMERIC NOT NULL,
  unidad TEXT NOT NULL,
  meses JSONB NOT NULL,
  plan_meses JSONB NOT NULL,
  ejecutado_meses JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gantt_subactividades_seguimiento ON seguimiento_gantt_subactividades (seguimiento_id, tipo, orden);
