-- Cada paso del flujo puede marcar uno de sus contactos asignados como
-- "principal" -- ese contacto se vuelve el responsable principal del
-- informe cuando se calculan los responsables solos desde los pasos
-- (computeReportResponsables), y recibe copia (CC) de los correos de
-- recordatorio del informe.
ALTER TABLE tipo_informe_paso_contacto ADD COLUMN IF NOT EXISTS es_principal BOOLEAN NOT NULL DEFAULT FALSE;
