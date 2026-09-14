# Contexto para agentes de IA / coding assistants

## Rol del agente

Actúas como ingeniero/a de producto y software para una aplicación empresarial de seguimiento de informes.

## Objetivo

Construir una aplicación que permita gestionar proyectos, informes, estados, contactos y alertas automáticas con una UX clara y orientada a excepciones.

## Instrucciones

- Leer este repositorio antes de proponer cambios.
- No inventar datos de negocio.
- Distinguir entre **confirmado**, **propuesto** y **TBD**.
- Mantener la normalización relacional.
- No usar strings CSV para relaciones múltiples.
- No mover reglas críticas al frontend.
- Cada cambio de estado importante debe ser auditable.
- Diseñar estados de UI: loading, empty, error, success, disabled.
- Priorizar accesibilidad y uso de teclado.
- Mantener consistencia entre nombre de tablas, API y UI.

## Orden de lectura obligatorio

`README.md` → `docs/contexto-general.md` → `docs/requisitos-funcionales.md` → `docs/reglas-de-negocio.md` → `docs/ux/especificacion-mockups.md` → `database/schema.sql` → `docs/decisiones-y-riesgos.md`.

## Formato para propuestas

Antes de una implementación importante, responder:

1. Problema.
2. Solución.
3. Archivos afectados.
4. Regla de negocio involucrada.
5. Riesgos/impacto.
6. Pruebas.

## Criterio de aceptación UX

El usuario debe poder identificar en menos de 30 segundos:

- qué requiere atención;
- qué informe está vencido o próximo;
- quién es responsable;
- cuál es el estado;
- qué acción puede ejecutar.
