# Contratos API de referencia

Estos endpoints son una propuesta inicial para diseñar frontend/backend. No representan una API existente verificada.

## Proyectos

`GET /api/projects`

Devuelve los proyectos registrados en `proyectos`, su empresa relacionada y los
tipos de informe asociados mediante `proyecto_tipo_informe`.

Respuesta exitosa:

```json
{
  "data": [
    {
      "id": "1",
      "name": "Proyecto de ejemplo",
      "bpin": "2024001000452",
      "active": true,
      "company_id": "1",
      "company_name": "Empresa de ejemplo",
      "applicable_type_ids": ["1"]
    }
  ],
  "meta": { "total": 1 },
  "errors": []
}
```

`GET /api/projects/:id`

`PUT /api/projects/:id`

## Informes

`GET /api/reports?projectId=&statusId=&typeId=&year=&month=`

`POST /api/reports`

`GET /api/reports/:id`

`PUT /api/reports/:id`

## Seguimiento

`POST /api/reports/:id/status-history`

`GET /api/reports/:id/status-history`

## Contactos

`GET /api/contacts`

## Alertas

`GET /api/alerts?projectId=`

`POST /api/alerts`

`PUT /api/alerts/:id`

`POST /api/alerts/:id/activate`

`POST /api/alerts/:id/deactivate`

## Catálogos

`GET /api/catalogs/report-types`

`GET /api/catalogs/statuses`

`GET /api/catalogs/roles`

## Respuesta estándar

```json
{
  "data": {},
  "meta": {},
  "errors": []
}
```
