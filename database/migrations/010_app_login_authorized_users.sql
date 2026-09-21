-- Login general de la app restringido a una lista de correos autorizados.
CREATE TABLE IF NOT EXISTS usuarios_autorizados (
  email VARCHAR(320) PRIMARY KEY,
  nombre VARCHAR(200),
  es_admin BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_sesiones (
  session_id UUID PRIMARY KEY,
  email VARCHAR(320) NOT NULL REFERENCES usuarios_autorizados(email) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

-- Administrador inicial: sin este bootstrap nadie podría entrar a agregar
-- al resto de usuarios autorizados.
INSERT INTO usuarios_autorizados (email, nombre, es_admin, activo)
VALUES ('a.rodriguez@gdm.com', 'Administrador', TRUE, TRUE)
ON CONFLICT (email) DO UPDATE SET es_admin = TRUE, activo = TRUE;
