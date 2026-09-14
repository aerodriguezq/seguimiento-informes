# Reglas de negocio

## RB-001 Tipos por proyecto

Un proyecto puede tener varios tipos de informe aplicables y un tipo puede aplicar a varios proyectos.

## RB-002 Proyecto sin tipos

La interfaz actual indica que, si no se marca ningún tipo, “Nuevo Informe” mostrará todos los tipos disponibles. Esta regla debe confirmarse con negocio antes de consolidarla.

## RB-003 Contactos

Un informe puede tener múltiples contactos asignados. Debe definirse cuál, si alguno, es el responsable principal.

## RB-004 Alertas

Una regla puede ser activa o inactiva. Una alerta puede programarse para varios días y tener varios destinatarios.

## RB-005 Estados

Estados identificados:

1. Pendientes Evidencias
2. Informe en Elaboración
3. Entregado a Of. Proyectos
4. Enviado

Las transiciones y permisos deben definirse explícitamente.

## RB-006 Semáforo

Propuesta UX:

- Verde: cumplido/enviado.
- Amarillo: próximo a vencer.
- Rojo: vencido.
- Gris: no aplica/inactivo.

El color debe acompañarse de texto/ícono.

## RB-007 Período

Mes y año deben ser campos estructurados. Evitar depender de texto libre como `Septiembre` para lógica del sistema.

## RB-008 Datos inconsistentes

Si fecha, mes, año o texto de mes no coinciden, el sistema debe marcar la inconsistencia para revisión y no sobrescribir silenciosamente el dato original.
