-- Campos de seguimiento histórico adicionales (pensados para la carga
-- masiva de informes anteriores): quién revisó, y las fechas REALES de
-- entrega y de revisión (distintas de la fecha límite contractual).
ALTER TABLE informes ADD COLUMN IF NOT EXISTS revisor_nombre TEXT;
ALTER TABLE informes ADD COLUMN IF NOT EXISTS fecha_entrega_real DATE;
ALTER TABLE informes ADD COLUMN IF NOT EXISTS fecha_revision DATE;
