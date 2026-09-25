-- Recordatorios escalonados por dias restantes (verde a los 5 dias,
-- amarillo a los 3, rojo desde 2 en adelante) y responsables vinculados a
-- Contactos de Listas Maestras (varios por peticion), en vez de un correo
-- suelto.
ALTER TABLE peticiones ADD COLUMN IF NOT EXISTS ultimo_recordatorio_nivel TEXT;
ALTER TABLE peticiones ADD COLUMN IF NOT EXISTS ultimo_recordatorio_en DATE;

CREATE TABLE IF NOT EXISTS peticion_responsables (
  peticion_id INTEGER NOT NULL REFERENCES peticiones(peticion_id) ON DELETE CASCADE,
  contacto_id INTEGER NOT NULL REFERENCES contactos(contacto_id) ON DELETE CASCADE,
  PRIMARY KEY (peticion_id, contacto_id)
);
CREATE INDEX IF NOT EXISTS idx_peticion_responsables_contacto ON peticion_responsables (contacto_id);
