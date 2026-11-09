-- Links sueltos de un proyecto (carpeta de Drive, acceso directo a un
-- documento o sistema externo, etc.), listados en la pestaña "Enlaces" de
-- Información General del Proyecto -- distinto de informe_adjuntos, que
-- vive a nivel de un Informe puntual, no del proyecto completo.
CREATE TABLE IF NOT EXISTS proyecto_enlaces (
  enlace_id SERIAL PRIMARY KEY,
  proyecto_id BIGINT NOT NULL REFERENCES proyectos(proyecto_id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proyecto_enlaces_proyecto ON proyecto_enlaces (proyecto_id);
