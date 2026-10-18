# CONTINUIDAD AGROPASCO

## ESTADO ACTUAL

Proyecto:
AgroPasco Digital

Repositorio:
Starfielcd/agropasco-platform-app

Branch:
main

Commit de producción:
9b4df1c
Migrate AgroPasco to PostgreSQL and secure production deployment

## PRODUCCIÓN

Render:
agropasco-digital

Estado:
LIVE

Base de datos:
PostgreSQL / Supabase

/api/health:
status = ok
service = agropasco-platform
database = connected

DB_PATH:
ELIMINADO de Render.

DATABASE_URL:
Configurado como secreto en Render.

IMPORTANTE:
NO mostrar ni guardar contraseñas, DATABASE_URL, JWT_SECRET ni otras credenciales en este archivo.

## MIGRACIÓN

Migración SQLite -> PostgreSQL:
COMPLETADA.

NO volver a ejecutar:
backend/scripts/migrate_to_pg.js

Auditoría posterior:
- users: 18
- crops: 7
- parcels: 6
- crop_logs: 8
- products: 12
- pest_reports: 6
- pest_report_responses: 2
- audit_logs: 19
- support_tickets: 3
- advisory_tips: 47
- 0 claves foráneas huérfanas
- secuencias PostgreSQL correctas

weather_cache:
Ahora puede contener registros nuevos generados normalmente por producción.
NO restaurarlo a 0.

## AUTENTICACIÓN

Admin oficial:
ID 16

Estado:
active
is_blocked = 0
must_change_password = 0

La autenticación fue corregida para impedir cambio de contraseña de otras cuentas.

NO guardar contraseñas en este archivo.

## ESTADO FUNCIONAL

Confirmado:
- Render LIVE
- Supabase conectado
- /api/health OK
- login administrador OK
- Panel Admin OK
- lectura PostgreSQL OK
- escritura weather_cache OK
- aplicación continúa funcionando después de eliminar DB_PATH

## SIGUIENTE OBJETIVO

NO modificar PostgreSQL.

NO repetir migración.

NO tocar todavía el servicio Node estable.

Siguiente fase:
AUDITORÍA DEL SERVICIO MACHINE LEARNING.

Hay que auditar:
- backend/ml-service
- FastAPI
- requirements
- modelos joblib
- endpoints
- ML_SERVICE_URL
- integración Node -> Python
- render.yaml
- compatibilidad Render Free
- seguridad
- health endpoint
- cold start
- manejo de errores

Primero SOLO LECTURA.

No desplegar ML hasta terminar la auditoría.