-- Marca por paso del flujo si requiere revisión (visto bueno u observación)
-- del responsable Principal antes de poder avanzar, en vez de avanzar solo
-- por detección de correo o por cualquier persona con edición en Informes.
ALTER TABLE tipo_informe_pasos ADD COLUMN IF NOT EXISTS requiere_revision BOOLEAN NOT NULL DEFAULT FALSE;
