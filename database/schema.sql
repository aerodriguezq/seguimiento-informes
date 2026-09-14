-- Esquema conceptual inicial basado en el modelo normalizado.
-- Ajustar tipos, índices, PK/FK y nomenclatura al motor elegido.

CREATE TABLE empresas (
  empresa_id BIGINT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  codigo VARCHAR(50)
);

CREATE TABLE proyectos (
  proyecto_id BIGINT PRIMARY KEY,
  empresa_id BIGINT REFERENCES empresas(empresa_id),
  nombre VARCHAR(200) NOT NULL,
  bpin VARCHAR(50),
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE tipos_informe (
  tipo_informe_id BIGINT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE proyecto_tipo_informe (
  proyecto_id BIGINT NOT NULL REFERENCES proyectos(proyecto_id),
  tipo_informe_id BIGINT NOT NULL REFERENCES tipos_informe(tipo_informe_id),
  PRIMARY KEY (proyecto_id, tipo_informe_id)
);

CREATE TABLE roles (
  rol_id BIGINT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE contactos (
  contacto_id BIGINT PRIMARY KEY,
  rol_id BIGINT REFERENCES roles(rol_id),
  nombre VARCHAR(160) NOT NULL,
  email VARCHAR(200),
  telefono VARCHAR(50),
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE estados (
  estado_id BIGINT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL UNIQUE,
  orden INT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE meses (
  mes_id SMALLINT PRIMARY KEY,
  nombre VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE informes (
  informe_id BIGINT PRIMARY KEY,
  proyecto_id BIGINT NOT NULL REFERENCES proyectos(proyecto_id),
  tipo_informe_id BIGINT NOT NULL REFERENCES tipos_informe(tipo_informe_id),
  estado_id BIGINT REFERENCES estados(estado_id),
  consecutivo VARCHAR(80),
  fecha DATE,
  anio SMALLINT,
  mes SMALLINT REFERENCES meses(mes_id),
  observaciones TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE informe_contacto (
  informe_id BIGINT NOT NULL REFERENCES informes(informe_id),
  contacto_id BIGINT NOT NULL REFERENCES contactos(contacto_id),
  es_principal BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (informe_id, contacto_id)
);

CREATE TABLE alertas (
  alerta_id BIGINT PRIMARY KEY,
  proyecto_id BIGINT NOT NULL REFERENCES proyectos(proyecto_id),
  nombre VARCHAR(160) NOT NULL,
  frecuencia VARCHAR(80),
  hora TIME,
  tipo_informe_id BIGINT REFERENCES tipos_informe(tipo_informe_id),
  consecutivo VARCHAR(80),
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE alerta_dia (
  alerta_id BIGINT NOT NULL REFERENCES alertas(alerta_id),
  dia SMALLINT NOT NULL,
  PRIMARY KEY (alerta_id, dia)
);

CREATE TABLE alerta_contacto (
  alerta_id BIGINT NOT NULL REFERENCES alertas(alerta_id),
  contacto_id BIGINT NOT NULL REFERENCES contactos(contacto_id),
  PRIMARY KEY (alerta_id, contacto_id)
);

CREATE TABLE alertas_config (
  config_id BIGINT PRIMARY KEY,
  clave VARCHAR(120) NOT NULL UNIQUE,
  valor TEXT
);

CREATE TABLE reglas_entrega (
  regla_entrega_id BIGINT PRIMARY KEY,
  proyecto_id BIGINT REFERENCES proyectos(proyecto_id),
  tipo_informe_id BIGINT REFERENCES tipos_informe(tipo_informe_id),
  dias_plazo INT,
  fecha_primera_entrega DATE,
  observaciones TEXT
);

CREATE TABLE seguimiento_informe (
  seguimiento_id BIGINT PRIMARY KEY,
  informe_id BIGINT NOT NULL REFERENCES informes(informe_id),
  estado_id BIGINT REFERENCES estados(estado_id),
  fecha_evento TIMESTAMP NOT NULL,
  usuario_id BIGINT,
  comentario TEXT
);

CREATE TABLE correcciones (
  correccion_id BIGINT PRIMARY KEY,
  entidad VARCHAR(120),
  registro_referencia VARCHAR(120),
  descripcion TEXT NOT NULL,
  prioridad VARCHAR(30),
  estado VARCHAR(30),
  evidencia TEXT
);

CREATE TABLE resumen_correcciones (
  resumen_id BIGINT PRIMARY KEY,
  total_correcciones INT,
  alta_prioridad INT,
  media_prioridad INT,
  baja_prioridad INT,
  notas TEXT
);
