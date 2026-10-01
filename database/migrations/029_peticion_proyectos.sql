-- Una petición ahora se asocia a uno o más proyectos (obligatorio al
-- menos uno), igual de m:n que peticion_responsables.
CREATE TABLE IF NOT EXISTS peticion_proyectos (
  peticion_id INTEGER NOT NULL REFERENCES peticiones(peticion_id) ON DELETE CASCADE,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(proyecto_id) ON DELETE CASCADE,
  PRIMARY KEY (peticion_id, proyecto_id)
);
CREATE INDEX IF NOT EXISTS idx_peticion_proyectos_proyecto ON peticion_proyectos (proyecto_id);
