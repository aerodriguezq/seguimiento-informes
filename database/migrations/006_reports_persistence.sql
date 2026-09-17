-- Vigencia del proyecto (fecha de inicio y fin del contrato/convenio).
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS fecha_inicio DATE;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS fecha_fin DATE;

-- El diseño original ligaba informes.estado_id/mes a catálogos (estados, meses)
-- que nunca se poblaron. Para simplificar y evitar depender de un seed manual,
-- se guarda el estado y el mes como texto plano directamente en informes.
ALTER TABLE informes ADD COLUMN IF NOT EXISTS estado VARCHAR(60) NOT NULL DEFAULT 'Pendientes Evidencias';
ALTER TABLE informes ADD COLUMN IF NOT EXISTS mes_nombre VARCHAR(20);
ALTER TABLE informes ALTER COLUMN mes DROP NOT NULL;
ALTER TABLE informes ALTER COLUMN estado_id DROP NOT NULL;

-- Igual para el historial de seguimiento: estado y usuario como texto plano.
ALTER TABLE seguimiento_informe ADD COLUMN IF NOT EXISTS estado VARCHAR(60);
ALTER TABLE seguimiento_informe ADD COLUMN IF NOT EXISTS usuario_nombre VARCHAR(200);
ALTER TABLE seguimiento_informe ALTER COLUMN estado_id DROP NOT NULL;
ALTER TABLE seguimiento_informe ALTER COLUMN usuario_id DROP NOT NULL;

-- Adjuntos del informe (solo metadatos; no hay almacenamiento de archivos real todavía).
CREATE TABLE IF NOT EXISTS informe_adjuntos (
  adjunto_id BIGINT PRIMARY KEY,
  informe_id BIGINT NOT NULL REFERENCES informes(informe_id) ON DELETE CASCADE,
  nombre VARCHAR(255) NOT NULL,
  tamano VARCHAR(50),
  subido_por VARCHAR(200),
  subido_en TIMESTAMP NOT NULL DEFAULT NOW()
);
