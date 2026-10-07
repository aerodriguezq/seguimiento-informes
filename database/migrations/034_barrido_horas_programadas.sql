-- En vez de "cada N minutos" (una frecuencia relativa a la última
-- ejecución, que no dice a qué hora del día corre), deteccion_entregas y
-- recordatorios_alertas ahora se programan con horas exactas del día (hora
-- Colombia, "HH:MM"), y se puede configurar más de una. El workflow de
-- GitHub Actions llama al endpoint cada 15 minutos; el backend decide si
-- hoy, a esta hora, toca ejecutar de verdad según esta lista.
ALTER TABLE barrido_config ADD COLUMN IF NOT EXISTS horas_programadas TEXT[] NOT NULL DEFAULT '{}';

UPDATE barrido_config SET horas_programadas = ARRAY['08:00', '13:00', '18:00']
WHERE kind IN ('deteccion_entregas', 'recordatorios_alertas') AND horas_programadas = '{}';
