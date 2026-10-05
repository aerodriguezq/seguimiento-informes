-- Si un contacto recibe recordatorios automáticos (alarma) o no -- antes
-- se devolvía siempre TRUE desde la API (ni siquiera leía una columna
-- real), así que la UI nunca reflejaba un cambio.
ALTER TABLE contactos ADD COLUMN IF NOT EXISTS alarma_activa BOOLEAN NOT NULL DEFAULT TRUE;
