-- Cuando un paso (sin requiere_revision) vence sin entrega (NO_RECIBIDA), el
-- recordatorio diario deja de mandarse a todos los contactos y pasa a
-- mandarse solo al Principal -- pero antes de cada recordatorio el barrido
-- busca correos parecidos de los contactos del paso; si encuentra alguno,
-- en vez de recordarle a la Principal se le pide validación manual a
-- MANDATORY_CC_EMAIL y el recordatorio queda en pausa hasta que decida.
ALTER TABLE informe_pasos_instancia ADD COLUMN IF NOT EXISTS espera_validacion_admin BOOLEAN NOT NULL DEFAULT FALSE;
-- Ids de mensaje de Gmail ya marcados como "no es esta entrega" para este
-- paso, para no volver a mostrárselos/avisar por ellos en próximas corridas.
ALTER TABLE informe_pasos_instancia ADD COLUMN IF NOT EXISTS candidatos_descartados TEXT[];
