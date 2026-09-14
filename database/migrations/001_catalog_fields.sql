-- Extiende los catálogos usados por la interfaz sin romper las tablas existentes.
ALTER TABLE tipos_informe
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(50),
  ADD COLUMN IF NOT EXISTS periodicidad VARCHAR(30) NOT NULL DEFAULT 'Mensual',
  ADD COLUMN IF NOT EXISTS descripcion TEXT NOT NULL DEFAULT '';

ALTER TABLE contactos
  ADD COLUMN IF NOT EXISTS empresa_id BIGINT REFERENCES empresas(empresa_id);

CREATE UNIQUE INDEX IF NOT EXISTS tipos_informe_codigo_unique
  ON tipos_informe (codigo)
  WHERE codigo IS NOT NULL;