# Contexto general del producto

## Problema

El seguimiento de informes se encuentra soportado por información tabular con proyectos, tipos de informe, estados, contactos y reglas de alerta. La aplicación debe convertir ese conjunto en una experiencia única y accionable.

## Actores

### Coordinador
Necesita una vista transversal por proyecto y cumplimiento.

### Supervisor
Necesita saber qué informes tiene a cargo y en qué estado se encuentran.

### Usuario
Necesita completar tareas asignadas y actualizar información operativa.

## Objetos del dominio

**Proyecto** agrupa informes, tipos aplicables y reglas de alerta.

**Informe** representa una entrega concreta para un proyecto, tipo y período.

**Contacto** representa una persona que puede recibir o participar en el seguimiento.

**Alerta** automatiza recordatorios o notificaciones de acuerdo con una regla programada.

**Estado** representa la etapa del ciclo de vida del informe.

## Fuente histórica

La hoja original contiene bloques de seguimiento por proyecto/mes/año y valores como `OK`, `FALTA` y `PENDIENTE POR ENVIAR`. Esa estructura sirve como antecedente, pero no debe copiarse como modelo transaccional.

## Principio de normalización

Las relaciones múltiples deben almacenarse mediante tablas puente en lugar de cadenas separadas por coma. Esto aplica especialmente a:

- tipos aplicables por proyecto;
- contactos asignados a informes;
- días de una alerta;
- contactos destinatarios de una alerta.
