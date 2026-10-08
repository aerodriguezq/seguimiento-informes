-- Historial de todos los correos que el sistema envía (manuales y
-- automáticos): recordatorios de alertas, de pasos de flujo, de
-- peticiones, notificaciones de asignación y correos de prueba. Se usa
-- para mostrar "qué correo se envió" en Usuarios Autorizados > Barridos.
CREATE TABLE IF NOT EXISTS correo_log (
  correo_log_id SERIAL PRIMARY KEY,
  enviado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  destinatarios TEXT[] NOT NULL,
  copia TEXT[],
  asunto TEXT NOT NULL,
  tipo TEXT NOT NULL,
  informe_id INTEGER REFERENCES informes(informe_id) ON DELETE SET NULL,
  alerta_id INTEGER REFERENCES alertas(alerta_id) ON DELETE SET NULL,
  peticion_id INTEGER REFERENCES peticiones(peticion_id) ON DELETE SET NULL,
  exito BOOLEAN NOT NULL DEFAULT TRUE,
  error_mensaje TEXT
);

CREATE INDEX IF NOT EXISTS idx_correo_log_enviado_en ON correo_log (enviado_en DESC);
