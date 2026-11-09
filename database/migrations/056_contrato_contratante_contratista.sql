-- Se simplifica el modelo de Contrato: en vez de una lista abierta de
-- participantes (como Convenio), cada contrato ahora guarda directamente
-- su contratante, su contratista y su valor. La tabla de participantes se
-- elimina (se creó en la migración 054 pero nunca llegó a usarse en
-- producción).
ALTER TABLE proyecto_contratos ADD COLUMN IF NOT EXISTS contratante TEXT;
ALTER TABLE proyecto_contratos ADD COLUMN IF NOT EXISTS contratista TEXT;
ALTER TABLE proyecto_contratos ADD COLUMN IF NOT EXISTS valor NUMERIC;

DROP TABLE IF EXISTS proyecto_contrato_participantes;
