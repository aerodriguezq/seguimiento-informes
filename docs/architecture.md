# Arquitectura de solución

## Capas sugeridas

### Frontend

Aplicación SPA o híbrida con módulos por dominio.

### Backend

API REST/JSON con autenticación corporativa y autorización por rol.

### Persistencia

Base de datos relacional siguiendo el esquema normalizado del repositorio.

### Automatización

Worker/scheduler para evaluar reglas de alerta y registrar ejecuciones.

## Dominios

- Projects
- Reports
- Report Types
- Contacts
- Alerts
- Notifications
- Catalogs
- Audit

## Reglas arquitectónicas

1. La lógica crítica vive en backend.
2. Frontend no decide permisos.
3. Todas las relaciones múltiples usan tablas puente.
4. IDs internos no deben mostrarse como etiquetas de negocio cuando exista un nombre legible.
5. Fechas en ISO 8601 internamente; formato localizado solo en UI.
