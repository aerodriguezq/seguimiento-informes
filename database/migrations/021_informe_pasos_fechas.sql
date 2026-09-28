-- Fase 1 del motor de etapas de Informes: cada paso de un tipo de informe
-- puede tener su propio dia de inicio (solo aplica al primer paso; los
-- siguientes inician cuando se detecta la entrega del paso anterior) y su
-- propio dia limite del mes, en vez de una sola fecha limite para todo el
-- informe. Ambas columnas son opcionales -- si no se configuran, ese paso
-- simplemente no calcula fechas propias (se degrada al comportamiento
-- actual de una sola fecha por informe).
ALTER TABLE tipo_informe_pasos ADD COLUMN IF NOT EXISTS dia_inicio SMALLINT;
ALTER TABLE tipo_informe_pasos ADD COLUMN IF NOT EXISTS dia_limite SMALLINT;

-- Progreso real de cada informe por cada paso de su tipo: fechas
-- calculadas, estado de la etapa y trazabilidad de la deteccion en Gmail
-- (correo real, fecha real de recepcion -- nunca "ahora", siempre la fecha
-- del correo).
CREATE TABLE IF NOT EXISTS informe_pasos_instancia (
  instancia_id SERIAL PRIMARY KEY,
  informe_id BIGINT NOT NULL REFERENCES informes(informe_id) ON DELETE CASCADE,
  paso_id BIGINT NOT NULL REFERENCES tipo_informe_pasos(paso_id) ON DELETE CASCADE,
  fecha_inicio DATE,
  fecha_limite DATE,
  estado_etapa VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
  fecha_recepcion_real TIMESTAMPTZ,
  correo_gmail_id TEXT,
  correo_remitente TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (informe_id, paso_id)
);
CREATE INDEX IF NOT EXISTS idx_informe_pasos_instancia_informe ON informe_pasos_instancia (informe_id);
CREATE INDEX IF NOT EXISTS idx_informe_pasos_instancia_limite ON informe_pasos_instancia (fecha_limite);

-- Backfill: los informes que ya estan en curso hoy (con un paso activo)
-- reciben una instancia de su paso actual, usando la fecha limite unica
-- que ya tenian, para que no queden en blanco en la nueva vista de etapas.
INSERT INTO informe_pasos_instancia (informe_id, paso_id, fecha_inicio, fecha_limite, estado_etapa)
SELECT informe_id, paso_actual_id, updated_at::date, fecha, 'ALERTA_GENERADA'
FROM informes
WHERE paso_actual_id IS NOT NULL AND flujo_completado = FALSE
ON CONFLICT (informe_id, paso_id) DO NOTHING;
