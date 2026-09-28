-- Fase 4 del motor de etapas: palabras clave opcionales por paso, para que
-- la busqueda en Gmail no dependa solo del asunto exacto (criterio
-- configurable adicional, ver findDeliveryEmail).
ALTER TABLE tipo_informe_pasos ADD COLUMN IF NOT EXISTS palabras_clave TEXT;
