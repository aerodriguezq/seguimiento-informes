-- Fase 2 del motor de etapas: recordatorios escalonados (verde 5 dias,
-- amarillo 3, rojo desde 2 en adelante) para las alertas de paso de
-- Informes, igual que ya existe para Peticiones. Se necesita rastrear que
-- nivel fue el ultimo enviado por cada etapa para no duplicar alertas.
ALTER TABLE informe_pasos_instancia ADD COLUMN IF NOT EXISTS ultimo_recordatorio_nivel VARCHAR(10);
ALTER TABLE informe_pasos_instancia ADD COLUMN IF NOT EXISTS ultimo_recordatorio_en DATE;
