-- Información general ampliada del proyecto (pedida en Segimiento.pdf):
-- Objetivo General, Municipios, Supervisor y el valor inicial del contrato
-- (el "valor actual" no se guarda aparte -- se calcula a partir del
-- historial de modificatorios, ver src/utils/projectStatus.ts).
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS objetivo_general TEXT;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS municipios TEXT;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS supervisor TEXT;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS valor_inicial NUMERIC;

-- Modificatorios del contrato: adiciones, prórrogas, suspensiones. El tipo
-- es texto libre (no enum rígido) para no necesitar una migración cada vez
-- que aparezca un tipo nuevo; los campos valor_inicial/valor_actual solo
-- aplican a Adición, título/nota solo a Suspensión -- el resto queda NULL
-- según el tipo, lo valida el formulario, no la base de datos.
CREATE TABLE IF NOT EXISTS proyecto_modificatorios (
  modificatorio_id SERIAL PRIMARY KEY,
  proyecto_id BIGINT NOT NULL REFERENCES proyectos(proyecto_id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  tipo TEXT NOT NULL,
  fecha_inicial DATE,
  fecha_final DATE,
  valor_inicial NUMERIC,
  valor_actual NUMERIC,
  titulo TEXT,
  nota TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proyecto_modificatorios_proyecto ON proyecto_modificatorios (proyecto_id, fecha_inicial);
