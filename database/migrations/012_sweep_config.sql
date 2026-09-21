CREATE TABLE IF NOT EXISTS barrido_config (
  kind TEXT PRIMARY KEY,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  frecuencia_minutos INTEGER NOT NULL DEFAULT 30,
  ultima_ejecucion TIMESTAMPTZ,
  ultimo_exito BOOLEAN,
  ultimo_resultado JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO barrido_config (kind, activo, frecuencia_minutos) VALUES
  ('deteccion_entregas', TRUE, 30),
  ('recordatorios_alertas', TRUE, 1440)
ON CONFLICT (kind) DO NOTHING;
