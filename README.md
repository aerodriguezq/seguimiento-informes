# Seguimiento de Informes

Sistema web para controlar informes asociados a proyectos, estados, responsables/contactos y alertas automáticas.

> **Estado del repositorio:** contexto funcional, UX y aplicación frontend integrada en la raíz del proyecto.

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

| Rol         | Necesidad                                       | Acciones principales                                             |
| ----------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Coordinador | Visión consolidada y control de cumplimiento    | Consultar, configurar, asignar, revisar alertas y seguimiento    |
| Supervisor  | Seguimiento operativo de informes asignados     | Consultar, actualizar estado, registrar observaciones/evidencias |
| Usuario     | Ejecutar tareas y mantener información asignada | Consultar, registrar y actualizar lo permitido                   |

## 5. Módulos

| Módulo                   | Prioridad | Descripción                                                |
| ------------------------ | --------: | ---------------------------------------------------------- |
| Dashboard                |        P0 | Indicadores, vencimientos, alertas y acciones prioritarias |
| Proyectos                |        P0 | Inventario y acceso a configuración/seguimiento            |
| Detalle de Proyecto      |        P0 | Tipos aplicables, alertas e informes del proyecto          |
| Informes                 |        P0 | Búsqueda, filtros, estados y seguimiento                   |
| Nuevo Informe            |        P0 | Alta guiada y validaciones                                 |
| Detalle de Informe       |        P0 | Ciclo de vida, responsables, historial y observaciones     |
| Alertas                  |        P1 | Reglas automáticas y destinatarios                         |
| Listas                   |        P1 | Catálogos maestros                                         |
| Centro de notificaciones |        P1 | Alertas próximas, activas y vencidas                       |

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

## 12. Aplicación local

La aplicación frontend vive en la raíz del repositorio y usa los datos de demostración de `src/data/mockData.ts`.

```bash
npm install
npm run dev
```

Comandos de validación y producción:

```bash
npm run lint
npm run build
npm run preview
```

### Neon y Vercel

La conexión server-side está disponible en `server/db.ts` y se verifica mediante `GET /api/health`.
Configura `DATABASE_URL` como variable de entorno en Vercel con la cadena de conexión de Neon
(incluyendo `sslmode=require`). No expongas esta variable con el prefijo `VITE_`.

Después de configurar la variable, valida el despliegue en:

```text
https://<tu-dominio>/api/health
```

El esquema inicial para ejecutar en Neon está en `database/schema.sql`.

El primer endpoint de datos está disponible en `GET /api/projects` y consulta
proyectos, empresas y sus tipos de informe directamente en Neon.

### Envío de correos con Google Apps Script

El botón **Probar Envío** no usa Gmail API. Vercel envía el evento al Web App de
Google Apps Script y el script usa `GmailApp.sendEmail` con la cuenta que lo
publicó. El código está en `integrations/google-apps-script/Code.gs`.

Configuración:

1. Abre [script.google.com](https://script.google.com) y crea un proyecto.
2. Copia el contenido de `integrations/google-apps-script/Code.gs` en el editor.
3. En **Project Settings → Script Properties**, crea `APP_SCRIPT_SHARED_SECRET`.
4. Usa un valor secreto largo y guárdalo también en Vercel con el mismo nombre.
5. En **Deploy → New deployment**, selecciona **Web app**.
6. Configura **Execute as: Me** y **Who has access: Anyone**.
7. Autoriza el acceso a Gmail cuando Google lo solicite.
8. Copia la URL `/exec` del deployment y guárdala en Vercel como
   `APP_SCRIPT_WEBHOOK_URL`.
9. Redeploya Vercel.

El endpoint interno `POST /api/alerts/send` valida destinatarios y mantiene el
secreto fuera del navegador. Si Apps Script no está configurado, la aplicación
mostrará un error controlado en lugar de afirmar que el correo fue enviado.

La aplicación incluye el módulo **Fuentes Drive** para guardar el enlace de la
carpeta compartida de origen y el enlace de la carpeta propia de destino. Su
tabla se crea con `database/migrations/002_drive_links.sql`. Apps Script y Colab
deben leer esta configuración, no guardar credenciales en el frontend.

La función `copyFilesFromSourceToDestination` replica la carpeta de origen
completa dentro de destino: incluye subcarpetas y archivos. Si se ejecuta de
nuevo, reutiliza carpetas y omite archivos con el mismo nombre para evitar
duplicados. El resultado queda disponible en el registro de ejecución de Apps
Script.

Desde Colab puedes disparar la misma copia con `copy_drive_tree(...)` usando la
URL del Web App de Apps Script en `APP_SCRIPT_WEBHOOK_URL`.

Para carpetas pesadas se recomienda el ejecutor directo de Colab en
`integrations/google-colab/drive_sync.py`. Ejecuta en una celda:

```python
!pip install -q google-api-python-client google-auth-httplib2 google-auth-oauthlib requests
%run integrations/google-colab/drive_sync.py
result = run_copy()
```

Colab solicitará autorización de Google Drive y copiará la estructura completa
por paginación, omitiendo archivos ya existentes. En este modo no necesitas
`APP_SCRIPT_WEBHOOK_URL`; solo `APP_SCRIPT_SHARED_SECRET` en Colab Secrets.

### Copia web con OAuth

La aplicación también puede conectar Google Drive directamente desde **Fuentes
Drive**. Configura en Vercel `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI`, y ejecuta
`database/migrations/003_google_drive_sessions.sql` en Neon. En Google Cloud,
la URI autorizada debe ser exactamente:

```text
https://seguimiento-informes.vercel.app/api/auth/google/callback
```

El usuario pulsa **Conectar Google Drive**, autoriza su cuenta y después puede
usar **Copiar carpeta completa** desde la web. Los tokens se guardan únicamente
en Neon server-side. Para carpetas muy grandes, Colab sigue siendo la opción
recomendada por los límites de ejecución de Vercel.

Los enlaces de origen/destino se guardan por cuenta de Google conectada (no de
forma global): cada cuenta ve y recupera sus propios últimos enlaces al volver
a conectarse. Ejecuta `database/migrations/004_drive_links_per_account.sql` en
Neon para migrar la tabla `drive_links` a esta clave por cuenta.

### Espejo de Neon en Google Sheets

El mismo Apps Script puede mantener una hoja espejo de Neon. Neon continúa siendo
la fuente de verdad; Sheets es una copia para consulta y exportación a `.xlsx`.

En **Project Settings → Script Properties** agrega:

```text
APP_URL=https://seguimiento-informes.vercel.app
APP_SCRIPT_SHARED_SECRET=el-mismo-secreto-configurado-en-vercel
SPREADSHEET_ID=el-id-de-la-hoja-de-google-sheets
```

Después ejecuta manualmente `syncDatabaseToSheet` una vez para autorizar Sheets y
comprobar la copia. Luego ejecuta `installDatabaseSyncTrigger` una vez para crear
un disparador cada 5 minutos. Se crearán pestañas con los nombres de las tablas
de Neon. Los datos que todavía no tengan CRUD persistente en Neon aparecerán
vacíos hasta que se conecten esos módulos.

## 13. Comandos sugeridos

```bash
# crear rama
 git checkout -b feat/dashboard

# instalar dependencias
 npm install

# ejecutar aplicación
 npm run dev
```

## 14. Estructura

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
├── src/
│   ├── App.tsx
│   ├── types.ts
│   ├── data/
│   └── components/
├── index.html
├── package.json
├── tsconfig.json
├── reference/
│   ├── pantalla-detalle-proyecto.png
│   ├── Control Informes - fuente.xlsx
│   ├── Control Informes - normalizado y correcciones.xlsx
│   ├── modelo-relacional-normalizado.drawio
│   └── informe-funcional-ux.docx
├── vite.config.ts
└── .github/
    ├── pull_request_template.md
    └── ISSUE_TEMPLATE/
```

## 15. Instrucción para agentes de IA

Antes de modificar el producto, leer en este orden:

1. `README.md`
2. `docs/contexto-general.md`
3. `docs/requisitos-funcionales.md`
4. `docs/reglas-de-negocio.md`
5. `docs/ux/especificacion-mockups.md`
6. `database/schema.sql`
7. `docs/decisiones-y-riesgos.md`

No inventar reglas de negocio cuando falte validación. Marcar las hipótesis como **TBD**.
