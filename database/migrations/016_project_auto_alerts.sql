-- El interruptor "Alertas automaticas" de Detalle de Proyecto nunca se
-- guardaba: no existia ninguna columna para persistirlo, asi que siempre se
-- inicializaba en false y se perdia al recargar. Por defecto TRUE para no
-- apagar de golpe algo que hoy simplemente no se estaba guardando.
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS alertas_automaticas BOOLEAN NOT NULL DEFAULT TRUE;
