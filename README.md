# Seguimiento de Informes

Sistema web para controlar informes asociados a proyectos, estados, responsables/contactos y alertas automáticas.

> **Estado del repositorio:** contexto funcional y UX preparado para iniciar diseño de mockups y desarrollo.

## 1. Propósito

Centralizar el seguimiento operativo de informes por proyecto, reduciendo la dependencia de hojas de cálculo y permitiendo responder rápidamente:

- ¿Qué proyectos requieren atención?
- ¿Qué informes están pendientes, próximos a vencer o vencidos?
- ¿Quién debe actuar?
- ¿En qué estado está cada informe?
- ¿Qué alertas están activas?

## 2. Fuente actual

La aplicación existente se conoce como **Seguimiento** y utiliza una navegación lateral con:

- Dashboard
- Informes
- Nuevo Informe
- Proyectos
- Alertas
- Listas

La captura de referencia disponible muestra la pantalla **Detalle de Proyecto**.

La URL de la aplicación entregada requiere autenticación de Google Workspace, por lo que este repositorio documenta la funcionalidad observada y el modelo de información disponible, sin asumir pantallas que no hayan sido verificadas visualmente.

## 3. Visión del producto

### Objetivo de negocio

Pasar de un control basado en registros dispersos a una plataforma operativa con trazabilidad, alertas y visibilidad por proyecto.

### Principios UX

1. **Acción antes que información:** el usuario debe saber qué hacer ahora.
2. **Contexto siempre visible:** proyecto, informe, período y responsable deben aparecer juntos cuando sean necesarios.
3. **Estados inequívocos:** usar texto + semáforo, no solo color.
4. **Trazabilidad:** cambios de estado, responsables, observaciones y alertas deben dejar historial.
5. **Configuración sin ambigüedad:** tipos aplicables y reglas de alerta deben ser explícitos.

## 4. Usuarios

| Rol | Necesidad | Acciones principales |
|---|---|---|
| Coordinador | Visión consolidada y control de cumplimiento | Consultar, configurar, asignar, revisar alertas y seguimiento |
| Supervisor | Seguimiento operativo de informes asignados | Consultar, actualizar estado, registrar observaciones/evidencias |
| Usuario | Ejecutar tareas y mantener información asignada | Consultar, registrar y actualizar lo permitido |

## 5. Módulos

| Módulo | Prioridad | Descripción |
|---|---:|---|
| Dashboard | P0 | Indicadores, vencimientos, alertas y acciones prioritarias |
| Proyectos | P0 | Inventario y acceso a configuración/seguimiento |
| Detalle de Proyecto | P0 | Tipos aplicables, alertas e informes del proyecto |
| Informes | P0 | Búsqueda, filtros, estados y seguimiento |
| Nuevo Informe | P0 | Alta guiada y validaciones |
| Detalle de Informe | P0 | Ciclo de vida, responsables, historial y observaciones |
| Alertas | P1 | Reglas automáticas y destinatarios |
| Listas | P1 | Catálogos maestros |
| Centro de notificaciones | P1 | Alertas próximas, activas y vencidas |

## 6. Pantalla clave actual

Referencia visual: [`reference/pantalla-detalle-proyecto.png`](reference/pantalla-detalle-proyecto.png)

La pantalla actual contiene:

1. Encabezado de **Detalle de Proyecto**.
2. Control para **Alertas automáticas** del proyecto.
3. Configuración de **Tipos de informe aplicables**.
4. Tabla de **Alertas Programadas de este Proyecto**.
5. Tabla de **Informes de este proyecto**.

### Mejora recomendada

Agregar al detalle del proyecto:

- Nombre del proyecto, empresa y BPIN.
- Estado general.
- KPIs: pendientes, próximos a vencer, vencidos, enviados.
- Botón **Nuevo informe**.
- Botón **Configurar alertas**.
- Semáforo de cumplimiento.
- Filtros y acciones por fila.
- Estados vacíos, loading, error y success.

## 7. Diseño de mockups

Resolución base: **Desktop 1440 px**.

Pantallas P0:

- M01 Dashboard
- M02 Informes
- M03 Nuevo Informe
- M04 Detalle de Informe
- M05 Proyectos
- M06 Detalle de Proyecto

Pantallas P1:

- M07 Alertas
- M08 Listas
- M09 Centro de notificaciones

Detalles en [`docs/ux/`](docs/ux/).

## 8. Datos y modelo relacional

Entidades principales:

- EMPRESAS
- PROYECTOS
- TIPOS_INFORME
- PROYECTO_TIPO_INFORME
- ROLES
- CONTACTOS
- ESTADOS
- MESES
- INFORMES
- INFORME_CONTACTO
- ALERTAS
- ALERTA_DIA
- ALERTA_CONTACTO
- ALERTAS_CONFIG
- REGLAS_ENTREGA
- SEGUIMIENTO_INFORME
- CORRECCIONES
- RESUMEN_CORRECCIONES

SQL de referencia: [`database/schema.sql`](database/schema.sql).

Diagrama: [`reference/modelo-relacional-normalizado.drawio`](reference/modelo-relacional-normalizado.drawio).

## 9. Reglas funcionales clave

- Los tipos de informe aplicables dependen del proyecto.
- La relación proyecto ↔ tipo de informe debe ser muchos-a-muchos.
- Una alerta puede tener múltiples días programados y múltiples contactos.
- Un informe puede tener múltiples contactos asignados.
- Los estados deben formar un ciclo de vida explícito.
- Las alertas deben poder activarse/desactivarse.
- Los períodos deben manejar mes y año estructurados.
- Los cambios relevantes deben ser trazables.

## 10. Validaciones pendientes

Hay datos fuente que requieren validación de negocio antes de convertirlos en reglas rígidas. En particular, se detectó una inconsistencia entre fecha, año, mes y texto de mes en registros de informes. No corregir silenciosamente; conservar evidencia y definir la regla oficial.

También debe confirmarse:

- Significado exacto de consecutivo.
- Responsable principal vs. contactos secundarios.
- Alcance de una alerta: proyecto, tipo de informe o combinación.
- Canales de notificación: correo, in-app o ambos.
- Permisos CRUD por rol.

## 11. Backlog inicial

### P0

- Crear shell de navegación.
- Crear Dashboard.
- Crear listado de proyectos.
- Crear detalle de proyecto.
- Crear listado de informes.
- Crear alta y detalle de informe.
- Implementar estados y semáforos.

### P1

- Motor de alertas.
- Centro de notificaciones.
- Catálogos maestros.
- Auditoría e historial.

### P2

- Exportaciones.
- Reportes avanzados.
- Configuración avanzada por proyecto.

## 12. Comandos sugeridos

```bash
# crear rama
 git checkout -b feat/dashboard

# instalar dependencias (según stack)
 npm install

# ejecutar tests
 npm test

# ejecutar aplicación
 npm run dev
```

## 13. Estructura

```text
seguimiento-informes-context/
├── README.md
├── docs/
│   ├── contexto-general.md
│   ├── requisitos-funcionales.md
│   ├── reglas-de-negocio.md
│   ├── flujos-usuario.md
│   ├── arquitectura.md
│   ├── decisiones-y-riesgos.md
│   ├── ux/
│   │   ├── inventario-pantallas.md
│   │   ├── especificacion-mockups.md
│   │   └── design-system.md
│   └── architecture/
│       └── api-contracts.md
├── database/
│   └── schema.sql
├── reference/
│   ├── pantalla-detalle-proyecto.png
│   ├── Control Informes - fuente.xlsx
│   ├── Control Informes - normalizado y correcciones.xlsx
│   ├── modelo-relacional-normalizado.drawio
│   └── informe-funcional-ux.docx
└── .github/
    ├── pull_request_template.md
    └── ISSUE_TEMPLATE/
```

## 14. Instrucción para agentes de IA

Antes de modificar el producto, leer en este orden:

1. `README.md`
2. `docs/contexto-general.md`
3. `docs/requisitos-funcionales.md`
4. `docs/reglas-de-negocio.md`
5. `docs/ux/especificacion-mockups.md`
6. `database/schema.sql`
7. `docs/decisiones-y-riesgos.md`

No inventar reglas de negocio cuando falte validación. Marcar las hipótesis como **TBD**.
