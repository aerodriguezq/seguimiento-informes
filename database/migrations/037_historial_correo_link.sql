-- Cuando el barrido de detección de entregas encuentra el correo que
-- avanza un paso, se guarda el link directo a ese correo en Gmail junto
-- con la entrada del Historial de Trazabilidad, para poder abrirlo y
-- hacerle seguimiento sin tener que buscarlo a mano en la bandeja.
ALTER TABLE seguimiento_informe ADD COLUMN IF NOT EXISTS correo_link TEXT;
