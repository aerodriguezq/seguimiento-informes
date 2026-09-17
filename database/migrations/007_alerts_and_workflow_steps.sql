-- Fase A: activar persistencia real para el módulo de Alertas.
ALTER TABLE alertas ALTER COLUMN proyecto_id DROP NOT NULL;
ALTER TABLE alertas ALTER COLUMN hora DROP NOT NULL;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS tipo VARCHAR(30) NOT NULL DEFAULT 'Seguimiento';
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS hora_texto VARCHAR(20);
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS ultimo_disparo TIMESTAMP;

-- Fase B: secuencia de pasos (responsables + asunto de correo esperado)
-- configurable por tipo de informe.
CREATE TABLE IF NOT EXISTS tipo_informe_pasos (
  paso_id BIGINT PRIMARY KEY,
  tipo_informe_id BIGINT NOT NULL REFERENCES tipos_informe(tipo_informe_id) ON DELETE CASCADE,
  orden INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  asunto_correo VARCHAR(200) NOT NULL,
  es_final BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (tipo_informe_id, orden)
);

CREATE TABLE IF NOT EXISTS tipo_informe_paso_contacto (
  paso_id BIGINT NOT NULL REFERENCES tipo_informe_pasos(paso_id) ON DELETE CASCADE,
  contacto_id BIGINT NOT NULL REFERENCES contactos(contacto_id),
  PRIMARY KEY (paso_id, contacto_id)
);

-- Fase C: progreso de cada informe a través de los pasos de su tipo, y el
-- vínculo entre una alerta y el paso que representa (para poder avanzar el
-- flujo cuando el paso se marca como entregado).
ALTER TABLE informes ADD COLUMN IF NOT EXISTS paso_actual_id BIGINT REFERENCES tipo_informe_pasos(paso_id);
ALTER TABLE informes ADD COLUMN IF NOT EXISTS flujo_completado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS informe_id BIGINT REFERENCES informes(informe_id) ON DELETE CASCADE;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS paso_id BIGINT REFERENCES tipo_informe_pasos(paso_id);
