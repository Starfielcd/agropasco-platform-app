# INFORME DE AUDITORÍA DE PERSISTENCIA Y REPARACIÓN ESTRUCTURAL FIX02

**Proyecto:** AgroPasco Digital  
**Rama de trabajo:** `fix/persistence-audit-fix02`  
**Commit:** `0872560`  
**Estado:** Correcciones estructurales implementadas y validadas con 100% de éxito en motor físico PostgreSQL aislado.  
**Políticas de despliegue:** Merge a `main`, push y despliegue a Render **NO ejecutados**, en estricto cumplimiento de la autorización restringida.

---

## 1. RESUMEN EJECUTIVO

Durante la fase FIX01 se auditó la capa de almacenamiento y registro multirol. Sin embargo, pruebas manuales posteriores identificaron tres bloqueos críticos en operaciones de persistencia:
1. **Error 1 (Parcelas):** *"El usuario con ID 22 no existe en la base de datos. Por favor inicia sesión nuevamente."*
2. **Error 2 (Cultivos):** *"Error al registrar cultivo: Error al registrar cultivo."*
3. **Error 3 (Supermercado):** *"Error al publicar producto: Error al publicar producto."*

Esta auditoría FIX02 resolvió de raíz la vulnerabilidad de identidad de sesión, la verificación contra PostgreSQL en el middleware de autenticación, la captura estricta del código SQLSTATE `23503` y la eliminación de duplicados en la interfaz de usuario, demostrando la persistencia física en PostgreSQL real sin alterar datos existentes.

---

## 2. INVESTIGACIÓN Y CAUSA RAÍZ DE LOS ERRORES DETECTADOS

### 2.1. Investigación del Usuario con ID 22
- **Diagnóstico realizado:** En producción (`NODE_ENV=production`), `database.js` omite intencionalmente `seedData()` para proteger la base de datos oficial. En entornos de prueba o semillas iniciales previas, se generaban usuarios locales cuyos IDs secuenciales alcanzaban el valor 22.
- **Origen del fallo:** Un navegador cliente que inició sesión contra una base de datos antigua conservó en su `localStorage` (`agropasco_token` y `agropasco_user`) un JWT válido criptográficamente pero emitido para el usuario ID 22.
- **Mecanismo de trampa:** El middleware `authenticateToken` original era **completamente apátrida** (`jwt.verify`); no consultaba la tabla `users` en PostgreSQL. Por tanto, el token con ID 22 era aceptado y pasaba al controlador.
- **Por qué el usuario quedaba atrapado:** En `parcelController.js`, al no encontrar al usuario ID 22 en la BD, se respondía con código **HTTP 400**. La función `apiRequest` de `frontend/js/api.js` está programada para limpiar la sesión y redirigir al login **únicamente ante códigos HTTP 401 y 403**. Al recibir un 400, el frontend no borraba el token obsoleto, condenando al agricultor a un bucle infinito de fallo.

### 2.2. Error en Registro de Cultivos y Publicación de Productos
- **Mecanismo del fallo:** A diferencia de `parcelController`, los controladores `cropController.js` y `supermarketController.js` no validaban previamente la existencia del usuario y procedían de inmediato con el `INSERT INTO crops` / `INSERT INTO products`.
- **Violación de Clave Foránea (`23503`):** PostgreSQL rechazaba la operación porque `user_id = 22` o `farmer_id = 22` violaba la restricción `REFERENCES users(id)`.
- **Causa del mensaje duplicado:** Ambos controladores capturaban la excepción y devolvían `{ success: false, error: 'Error al registrar cultivo.' }` con HTTP 500. En el cliente, `frontend/js/crops.js` ejecutaba:
  ```javascript
  showToast(`Error al registrar cultivo: ${errorMsg}`, 'error');
  ```
  Al concatenar el prefijo con el mensaje del backend, se producía textualmente: `"Error al registrar cultivo: Error al registrar cultivo."`. Lo mismo ocurría en `frontend/js/supermarket.js` para los productos.

---

## 3. VERIFICACIÓN DEL ESQUEMA REAL DE POSTGRESQL

Antes de implementar las correcciones se auditó el esquema real en `backend/config/database.js`:
- **Tabla `users`:** Columnas verificadas: `id`, `name`, `email`, `role`, `location`, `phone`, `status` (`'active'`, `'blocked'`, `'disabled'`, `'pending'`), `is_blocked` (INTEGER 0/1), `must_change_password`, `approved_by`, `rejection_reason`, `approved_at`, `created_at`, `updated_at`.
- **Tabla `parcels`:** `user_id INTEGER NOT NULL REFERENCES users(id)`, `name`, `geo_json`, `area_hectares`, `center_lat`, `center_lng`, `crop_type`, `crop_id REFERENCES crops(id)`, `planting_date`, `status`, `altitude_masl`, `notes`, `photo_url`.
- **Tabla `crops`:** `user_id INTEGER NOT NULL REFERENCES users(id)`, `name`, `crop_type`, `variety`, `area_hectares`, `planting_date`, `expected_harvest_date`, `status`, `location_detail`, `altitude_masl`, `notes`, `photo_url`.
- **Tabla `crop_logs`:** `crop_id INTEGER NOT NULL REFERENCES crops(id)`, `action_type`, `description`, `weather_snapshot`, `photo_url`.
- **Tabla `products`:** `farmer_id INTEGER REFERENCES users(id)`, `name`, `crop_type`, `quality`, `origin`, `stock_kg`, `price_per_kg`, `unit`, `description`, `traceability_code`, `certified_natural`, `photo_url`, `validation_status` (`'pending'`, `'approved'`, `'rejected'`), `original_price`.

---

## 4. ARCHIVOS MODIFICADOS Y CORRECCIONES APLICADAS

| Archivo | Corrección Estructural |
| :--- | :--- |
| `backend/middleware/auth.js` | `authenticateToken` convertido a `async`. Realiza consulta física a PostgreSQL (`SELECT id, name, email, role, status, is_blocked FROM users WHERE id = ?`). Retorna **HTTP 401** (`code: 'USER_NOT_FOUND'`) para sesiones con usuarios inexistentes sin exponer IDs ni datos sensibles. Retorna **HTTP 403** (`ACCOUNT_BLOCKED` o `ACCOUNT_PENDING`) para cuentas desactivadas o bloqueadas. |
| `backend/controllers/parcelController.js` | Uso estricto de `req.user.id` (ignora cualquier `user_id` enviado por el cliente). Respuesta **HTTP 401** ante usuario inexistente en BD. Captura explícita de SQLSTATE `23503` ante violaciones de integridad referencial devolviendo `code: 'FOREIGN_KEY_VIOLATION'`. |
| `backend/controllers/cropController.js` | Validación de usuario autenticado contra PostgreSQL con **HTTP 401**. Captura explícita de código SQLSTATE `23503`. |
| `backend/controllers/supermarketController.js` | En `publishProduct`, verificación estricta de que el usuario existe y posee el rol `farmer` (**HTTP 403** `FORBIDDEN_ROLE` si no lo es). Captura de SQLSTATE `23503`. |
| `frontend/js/parcels.js` | Se eliminó el envío de `user_id: currentUserId` en el payload de creación de parcela, dejando la autoría 100% en manos del token autenticado por el servidor. |
| `frontend/js/crops.js` | Se corrigió la función del toast para verificar si `errorMsg` ya inicia con el prefijo, evitando la duplicación de texto. |
| `frontend/js/supermarket.js` | Se corrigió la función del toast de publicación de producto para evitar la duplicación de texto. |
| `backend/tests/test_fix02_persistence_integration.js` | Nueva suite de pruebas de integración con PostgreSQL físico efímero (24 pruebas). |
| `backend/tests/test_uiux09_supermarket_verification.js` | Actualización del mock de usuarios para compatibilidad con la nueva consulta de validación de identidad. |

---

## 5. EVIDENCIAS DE PERSISTENCIA FÍSICA EN POSTGRESQL REAL

Para cumplir con la exigencia de verificación sin mocks, se ejecutó un clúster efímero de **PostgreSQL 18** en `127.0.0.1:55433` con el esquema oficial de 16 tablas.

### Resumen de Pruebas A, B, C, D, E y F (Suite FIX02)
- **TEST A (Parcela):**
  - Registro de parcela georreferenciada con polígono GeoJSON, altitud 4180 msnm y fotografía en vivo.
  - Inserción confirmada con HTTP 201 y posterior consulta `SELECT * FROM parcels WHERE id = ?` en PostgreSQL físico.
  - Comprobado que `user_id` asignado en PostgreSQL corresponde al usuario del token, descartando intentos de inyección en el body.
- **TEST B (Cultivo y Trazabilidad):**
  - Registro de cultivo de papa Huayro con variedad y fecha de siembra.
  - Inserción confirmada en PostgreSQL y verificación de creación automática de la fila hija en `crop_logs` con clave foránea `crop_id`.
- **TEST C (Supermercado):**
  - Publicación de lote de maca negra premium por agricultor con fotografía obligatoria.
  - Verificación en PostgreSQL: estado `pending`, código de trazabilidad único generado y persistencia de URL real de fotografía.
- **TEST D (Sesión Inválida, Usuario Fantasma ID 22 y SQLSTATE 23503):**
  - Token con usuario ID 22 rechazado categóricamente con **HTTP 401** (`code: 'USER_NOT_FOUND'`).
  - El mensaje emitido fue limpio y amigable: *"Sesión inválida o expirada. Por favor inicia sesión nuevamente."*, sin exponer el ID numérico.
  - Comprobado que el conteo de filas en `parcels` permaneció inalterado (0 registros huérfanos).
  - Provocación controlada de error de FK en motor físico: PostgreSQL emitió con precisión el código nativo **`23503`**.
- **TEST E (Control de Acceso y Roles):**
  - Asesor técnico intentando publicar producto: rechazado con **HTTP 403** (`FORBIDDEN_ROLE`).
  - Agricultor B intentando modificar parcela del Agricultor A: rechazado con **HTTP 404** (aislamiento estricto por `user_id`).
  - Cuenta bloqueada en BD (`is_blocked = 1`) intentando operar con firma JWT válida: rechazada con **HTTP 403** (`ACCOUNT_BLOCKED`).
- **TEST F (Interfaz y Mensajes):**
  - Validación de que los mensajes en pantalla no se duplican.

---

## 6. RESULTADOS GLOBALES DE PRUEBAS AUTOMATIZADAS

| Suite de Pruebas | Tipo | Aprobadas | Fallidas | Estado |
| :--- | :--- | :---: | :---: | :---: |
| `test_fix02_persistence_integration.js` | **PostgreSQL Físico Real** | 24 | 0 | ✅ PASSED |
| `test_fix01_post_deploy_audit.js` | Integración / Unidad | 15 | 0 | ✅ PASSED |
| `test_storage_persistence.js` | Integración Supabase Storage | 10 | 0 | ✅ PASSED |
| `test_uiux09_supermarket_verification.js` | Funcional Supermercado | 16 | 0 | ✅ PASSED |
| `test_fixes_validation.js` | Regresión / Seguridad / SQL | 66 | 0 | ✅ PASSED |
| `test_meteo02_validation_and_regression.js` | Meteorología / Cache ML | 32 | 0 | ✅ PASSED |
| **TOTAL GENERAL** | | **163** | **0** | **100% OK** |

---

## 7. COMMIT REALIZADO Y ASPECTOS PENDIENTES

### Commit Local en Rama Aislada
- **Rama:** `fix/persistence-audit-fix02`
- **Hash de Commit:** `0872560`
- **Mensaje:** `fix(persistence): resolver identidad de sesion, claves foraneas y persistencia multirol FIX02`
- **Archivos en commit:** 9 archivos (8 modificados, 1 nuevo de pruebas).

### Estado de `main` y Entorno de Producción
- La rama `main` permanece intacta en el commit `26f64bb` (FIX01).
- No se ha ejecutado `git push origin main` ni se ha iniciado ningún despliegue a Render.

### Aspectos que Siguen Pendientes de Verificación Real en Producción (Render)
1. **Limpieza automática de sesiones cliente antiguas en el navegador:** Cuando el usuario abra la web en producción con una sesión residual antigua (ID 22), el backend responderá con HTTP 401, lo cual activará la rutina de `frontend/js/api.js` que borra el `localStorage` y redirige limpiamente al formulario de inicio de sesión (`#/login`).
2. **Prueba de ciclo completo en Supabase PostgreSQL de Producción:** Registro de una cuenta nueva de agricultor desde la UI pública, registro de parcela en el mapa satelital, registro de cultivo y publicación en el supermercado con fotografía persistente en Supabase Storage.
