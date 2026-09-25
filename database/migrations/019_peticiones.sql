-- Registro general de peticiones/PQRS (no asociado a un proyecto), con la
-- misma estructura de columnas que la hoja de calculo que se usaba antes.
CREATE TABLE IF NOT EXISTS peticiones (
  peticion_id SERIAL PRIMARY KEY,
  radicado TEXT NOT NULL DEFAULT '',
  fecha_radicacion DATE,
  peticionario TEXT NOT NULL DEFAULT '',
  asunto TEXT NOT NULL DEFAULT '',
  area_consolida TEXT NOT NULL DEFAULT '',
  correo_persona_asignada TEXT NOT NULL DEFAULT '',
  areas_intervienen TEXT NOT NULL DEFAULT '',
  plazo_respuesta INTEGER,
  fecha_plazo_respuesta DATE,
  fecha_radicado_respuesta DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_peticiones_fecha_plazo ON peticiones (fecha_plazo_respuesta);
