-- Un proyecto puede tener N contratos (ej. Contrato principal, Otrosí,
-- Contrato de interventoría, etc.), cada uno con su propia lista de
-- participantes (nombre, rol y valor opcionales) -- misma estructura que
-- proyecto_convenios/proyecto_convenio_participantes, para la nueva
-- pestaña "Contratos" de Información General del Proyecto.
CREATE TABLE IF NOT EXISTS proyecto_contratos (
  contrato_id SERIAL PRIMARY KEY,
  proyecto_id BIGINT NOT NULL REFERENCES proyectos(proyecto_id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  nombre TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proyecto_contratos_proyecto ON proyecto_contratos (proyecto_id);

CREATE TABLE IF NOT EXISTS proyecto_contrato_participantes (
  participante_id SERIAL PRIMARY KEY,
  contrato_id BIGINT NOT NULL REFERENCES proyecto_contratos(contrato_id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  rol TEXT,
  valor NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_proyecto_contrato_participantes_contrato ON proyecto_contrato_participantes (contrato_id);
