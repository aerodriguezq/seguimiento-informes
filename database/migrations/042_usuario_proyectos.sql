-- Control de acceso por proyecto: qué usuarios autorizados pueden ver cuáles
-- proyectos, para la remasterización donde la app queda acotada a "un
-- proyecto a la vez" (se elige en una pantalla de tarjetas justo después de
-- iniciar sesión). Cero filas para un email = acceso a TODOS los proyectos
-- (mismo criterio "permitido salvo restricción explícita" que ya usa
-- usuarios_autorizados.permisos) -- así ningún usuario existente pierde
-- acceso con esta migración; el admin restringe a alguien insertando filas
-- específicas para su email.

CREATE TABLE IF NOT EXISTS usuario_proyectos (
  email        TEXT NOT NULL REFERENCES usuarios_autorizados(email) ON DELETE CASCADE,
  proyecto_id  BIGINT NOT NULL REFERENCES proyectos(proyecto_id) ON DELETE CASCADE,
  PRIMARY KEY (email, proyecto_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_proyectos_proyecto ON usuario_proyectos (proyecto_id);
