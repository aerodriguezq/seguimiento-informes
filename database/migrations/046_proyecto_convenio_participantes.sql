-- Entidades que participan del convenio del proyecto (Ejecutor,
-- Cofinanciador, Supervisor, Beneficiario, etc.) -- distinto de
-- proyecto_aportantes, que reparte el valor, esto es solo el listado de
-- quién hace parte del convenio.
CREATE TABLE IF NOT EXISTS proyecto_convenio_participantes (
  participante_id SERIAL PRIMARY KEY,
  proyecto_id BIGINT NOT NULL REFERENCES proyectos(proyecto_id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  rol TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proyecto_convenio_participantes_proyecto ON proyecto_convenio_participantes (proyecto_id);
