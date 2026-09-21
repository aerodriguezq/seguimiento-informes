-- Permisos por módulo para cada usuario autorizado. Formato:
-- {"reports": "edit", "projects": "view", "alerts": "none", ...}
-- Los administradores ignoran esta columna (acceso total siempre).
ALTER TABLE usuarios_autorizados ADD COLUMN IF NOT EXISTS permisos JSONB NOT NULL DEFAULT '{}'::jsonb;
