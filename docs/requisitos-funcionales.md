# Requisitos funcionales

## RF-001 Dashboard

El sistema debe mostrar un resumen de cumplimiento por proyecto e informe.

### Indicadores mínimos

- Informes pendientes.
- Informes en elaboración.
- Entregados a oficina de proyectos.
- Enviados.
- Vencidos.
- Próximos a vencer.
- Alertas activas.

## RF-002 Proyectos

Permitir listar, buscar, filtrar y abrir el detalle de proyectos.

## RF-003 Detalle de proyecto

Mostrar:

- Datos de identificación.
- Tipos aplicables.
- Alertas programadas.
- Informes asociados.
- Indicadores de cumplimiento.

## RF-004 Nuevo informe

Flujo recomendado:

1. Seleccionar proyecto.
2. Seleccionar tipo aplicable.
3. Seleccionar mes/año.
4. Registrar fecha.
5. Asignar contactos.
6. Definir estado inicial.
7. Agregar observaciones/evidencias.
8. Guardar.

## RF-005 Detalle de informe

Mostrar datos, estado actual, historial de estados, contactos, observaciones y alertas relacionadas.

## RF-006 Alertas

Crear, editar, activar/desactivar y consultar reglas de alerta.

## RF-007 Catálogos

Administrar tipos de informe, estados, roles, contactos y meses según permisos.

## RF-008 Trazabilidad

Registrar al menos: creación, cambios de estado, cambios de responsables, activación/desactivación de alertas y observaciones relevantes.

## RF-009 Búsqueda y filtros

Toda pantalla de listado debe ofrecer búsqueda y filtros contextuales.

## RF-010 Permisos

Los permisos deben basarse en rol y validarse en backend, no solamente en UI.
