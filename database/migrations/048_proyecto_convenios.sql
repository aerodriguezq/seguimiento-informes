-- Permite N convenios por proyecto, cada uno con su propia lista de
-- participantes (antes era una sola lista plana por proyecto). Los
-- participantes que ya existían se migran a un "Convenio 1" por defecto
-- para no perder la información ya cargada.
CREATE TABLE IF NOT EXISTS proyecto_convenios (
  convenio_id SERIAL PRIMARY KEY,
  proyecto_id BIGINT NOT NULL REFERENCES proyectos(proyecto_id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  nombre TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proyecto_convenios_proyecto ON proyecto_convenios (proyecto_id);

-- Backfill: un "Convenio 1" por cada proyecto que ya tenga participantes cargados.
INSERT INTO proyecto_convenios (proyecto_id, numero)
SELECT DISTINCT pcp.proyecto_id, 'Convenio 1'
FROM proyecto_convenio_participantes pcp
WHERE NOT EXISTS (
  SELECT 1 FROM proyecto_convenios pc WHERE pc.proyecto_id = pcp.proyecto_id
);

ALTER TABLE proyecto_convenio_participantes ADD COLUMN IF NOT EXISTS convenio_id BIGINT;

UPDATE proyecto_convenio_participantes pcp
SET convenio_id = pc.convenio_id
FROM proyecto_convenios pc
WHERE pc.proyecto_id = pcp.proyecto_id AND pcp.convenio_id IS NULL;

ALTER TABLE proyecto_convenio_participantes ALTER COLUMN convenio_id SET NOT NULL;
ALTER TABLE proyecto_convenio_participantes DROP CONSTRAINT IF EXISTS fk_convenio_participante_convenio;
ALTER TABLE proyecto_convenio_participantes ADD CONSTRAINT fk_convenio_participante_convenio
  FOREIGN KEY (convenio_id) REFERENCES proyecto_convenios(convenio_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_proyecto_convenio_participantes_convenio ON proyecto_convenio_participantes (convenio_id);

ALTER TABLE proyecto_convenio_participantes DROP COLUMN IF EXISTS proyecto_id;
