INSERT INTO barrido_config (kind, activo, frecuencia_minutos) VALUES
  ('importacion_cronograma', TRUE, 60)
ON CONFLICT (kind) DO NOTHING;
