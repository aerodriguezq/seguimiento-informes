-- Cachea la lista de hijos de destino (Drive) que ya se consultó para cada
-- carpeta durante una copia/validación -- antes cada invocación (cada
-- sondeo del navegador, o cada corrida del barrido por cron) volvía a
-- pedirle a Drive el listado completo de una carpeta destino ya consultada
-- en una invocación anterior del MISMO job, aunque nada hubiera cambiado.
-- Ahora, una vez listada, esa respuesta queda guardada y se reusa por el
-- resto del job -- la invocación solo le pide a Drive lo que todavía no
-- conoce.
ALTER TABLE drive_copy_items ADD COLUMN IF NOT EXISTS dest_children JSONB;
ALTER TABLE drive_copy_jobs ADD COLUMN IF NOT EXISTS dest_root_children JSONB;
