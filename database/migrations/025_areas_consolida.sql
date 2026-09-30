-- Lista controlada de "areas que consolidan" para Peticiones, administrable
-- desde Listas Maestras (antes era texto libre).
CREATE TABLE IF NOT EXISTS areas_consolida (
  area_id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL UNIQUE
);

INSERT INTO areas_consolida (nombre) VALUES
  ('Ejecución'), ('Estructuración'), ('Jurídica'), ('Talento Humano')
ON CONFLICT (nombre) DO NOTHING;
