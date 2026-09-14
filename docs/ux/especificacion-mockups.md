# Especificación para mockups

## Dirección visual

La interfaz actual utiliza un layout administrativo con sidebar, tarjetas y tablas. Se recomienda mantener esa familiaridad pero reforzar jerarquía, densidad informativa y acciones.

## M06 — Detalle de Proyecto

### Header

- Breadcrumb: Proyectos / [Proyecto]
- Nombre del proyecto
- Empresa
- BPIN
- Estado
- Botón: Nuevo informe
- Botón: Configurar alertas

### KPIs

- Pendientes
- Próximos a vencer
- Vencidos
- Enviados

### Tipos aplicables

Usar checkboxes/chips. Mostrar claramente seleccionados y no seleccionados.

### Alertas

Columnas recomendadas:

- Nombre
- Frecuencia/programación
- Próxima ejecución
- Hora
- Tipo
- Destinatarios
- Estado
- Acción

### Informes

Columnas recomendadas:

- #
- Tipo
- Período
- Fecha
- Estado
- Responsable
- Días restantes
- Contactos
- Acción

### Estados especiales

Diseñar cuatro variantes:

- Loading / skeleton
- Sin datos
- Error de carga
- Con datos

## M02 — Informes

Toolbar con búsqueda, proyecto, tipo, estado, mes/año, rango de fecha. Tabla con semáforo y acciones.

## M03 — Nuevo Informe

Formulario de una sola página para desktop, dividido visualmente en:

1. Identificación
2. Período
3. Responsables
4. Estado/evidencias
5. Observaciones

## M04 — Detalle de Informe

Hero + timeline de estados + información de responsables + alertas + observaciones + historial.

## M01 — Dashboard

Primero excepciones, luego KPIs y después tendencia/agrupación por proyecto.
