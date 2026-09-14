# Decisiones, supuestos y riesgos

## Decisiones confirmadas por la interfaz

- Existe navegación lateral.
- Existe módulo de proyectos.
- El detalle del proyecto permite activar/desactivar alertas automáticas.
- El detalle muestra tipos de informe aplicables.
- El detalle muestra alertas programadas.
- El detalle muestra informes asociados.

## Supuestos

Los endpoints, permisos detallados, frecuencia real de alertas y persistencia no fueron verificados contra el backend.

## Riesgos

### R1 — Inconsistencia de período

Fecha, año, mes y texto de mes pueden no coincidir en los datos históricos. Definir la fuente de verdad.

### R2 — Roles inconsistentes

Los nombres de roles en contactos no coinciden exactamente con el catálogo de roles. Se requiere mapeo/catálogo canónico.

### R3 — Tipos en texto libre

No almacenar listas separadas por coma en campos transaccionales.

### R4 — Alertas ambiguas

El concepto de consecutivo aparece sobrecargado en datos históricos. Separar consecutivo de tipo de informe.

### R5 — Datos vacíos

Diseñar explícitamente empty states y validaciones.
