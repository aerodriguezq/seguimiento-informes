-- Radicado automatico: año-empresa-consecutivo (ej. 2026-CRI-00001). Se
-- necesita la empresa de la peticion para poder construirlo.
ALTER TABLE peticiones ADD COLUMN IF NOT EXISTS empresa_id BIGINT REFERENCES empresas(empresa_id);
