# 🚀 Guía de Despliegue en Render (100% Plan Gratuito) — AgroPasco Digital

Esta guía detalla el procedimiento para desplegar la arquitectura completa de AgroPasco en [Render](https://render.com) en su **Capa Gratuita (Free Tier)** y con persistencia permanente en **PostgreSQL (Supabase Free)** sin incurrir en costos de suscripción ni discos de pago.

---

## 🏗️ Arquitectura en Producción (0 Costo)

El sistema se compone de servicios desacoplados en planes gratuitos:

1. **`agropasco-ml-service` (Web Service Python / FastAPI — Render Free):**
   - Inferencia meteorológica, modelos serializados (`.joblib` versionados en repo), cálculo de riesgo y alertas.
   - Puerto interno: `$PORT`.
2. **`agropasco-platform` (Web Service Node.js / Express — Render Free):**
   - API REST, autenticación JWT, gestión de parcelas, trazabilidad, supermercado campesino y SPA frontend.
   - Sin discos de pago: el sistema de archivos es efímero, por lo que **toda la persistencia reside en PostgreSQL externo**.
3. **Base de Datos Externa (PostgreSQL — Supabase Free Tier):**
   - 500 MB de almacenamiento gratuito, backups automáticos, alta disponibilidad y SSL.
   - Conectada a través de la variable `DATABASE_URL`.

---

## 🛡️ PASO 0: Exportación de Datos Activos en Render (¡Antes de Re-desplegar!)

> [!CAUTION]
> Si tu servicio activo en Render aún tiene datos que deseas conservar en su disco anterior (`/var/data/agropasco.db`), **debes exportarlos antes de autorizar un nuevo despliegue**.

1. Entra a tu [Dashboard de Render](https://dashboard.render.com) → Selecciona `agropasco-platform` → Pestaña **Shell**.
2. Ejecuta los comandos de exportación segura:
   ```bash
   # Generar dump SQL completo de respaldo
   sqlite3 /var/data/agropasco.db .dump > /var/data/backup_full.sql

   # Ver conteo de registros actuales
   sqlite3 /var/data/agropasco.db "SELECT 'users' AS tabla, COUNT(*) FROM users UNION ALL SELECT 'parcels', COUNT(*) FROM parcels;"
   ```
3. Descarga el backup a través del explorador de archivos del Shell o copia los datos esenciales.

---

## 🛠️ Método 1: Despliegue Automático con `render.yaml` (Recomendado)

El repositorio incluye [`render.yaml`](./render.yaml) preconfigurado para el **Free Tier**.

1. Inicia sesión en [Render Dashboard](https://dashboard.render.com).
2. Haz clic en **New +** y selecciona **Blueprint**.
3. Conecta tu repositorio de GitHub `agropasco-platform`.
4. Render detectará automáticamente [`render.yaml`](./render.yaml).
5. En la configuración de variables del Blueprint, ingresa el valor de `DATABASE_URL` correspondiente a tu proyecto de Supabase.
6. Haz clic en **Apply**. Render desplegará e interconectará ambos servicios automáticamente.

---

## 🛠️ Método 2: Despliegue Manual (Paso a Paso)

### Paso 1: Crear Base de Datos en Supabase (Gratuito)

1. Regístrate o inicia sesión en [Supabase](https://supabase.com).
2. Crea un nuevo proyecto (ejemplo: `agropasco-db`) seleccionando la región más cercana (ej. `US East`).
3. En **Project Settings** > **Database** > **Connection string** > **URI**, copia la URL:
   - Ejemplo: `postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`
4. Guarda tu contraseña de base de datos en un lugar seguro.

### Paso 2: Desplegar el Microservicio ML (`agropasco-ml-service`)

1. En Render, haz clic en **New +** > **Web Service**.
2. Conecta tu repositorio de GitHub.
3. Configura:
   - **Name:** `agropasco-ml-service`
   - **Region:** `Oregon (US West)`
   - **Root Directory:** `backend/ml-service`
   - **Runtime:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app:app --host 0.0.0.0 --port $PORT`
   - **Plan:** `Free`
4. En **Advanced** > **Health Check Path**, coloca `/health`.
5. Haz clic en **Create Web Service**.
6. Copia la URL pública generada (ej: `https://agropasco-ml-service.onrender.com`).

---

### Paso 3: Desplegar la Plataforma Principal (`agropasco-platform`)

1. En Render, haz clic en **New +** > **Web Service**.
2. Conecta tu repositorio de GitHub.
3. Configura:
   - **Name:** `agropasco-platform`
   - **Region:** La misma que el servicio ML (`Oregon`).
   - **Root Directory:** *(dejar en blanco)*
   - **Runtime:** `Node`
   - **Build Command:** `npm install && cd backend && npm install`
   - **Start Command:** `cd backend && node server.js`
   - **Plan:** `Free` *(sin discos de pago)*
4. En **Environment Variables**, añade:
   | Variable | Valor | Descripción |
   | :--- | :--- | :--- |
   | `NODE_ENV` | `production` | Modo de producción |
   | `JWT_SECRET` | *(Cadena aleatoria de 32+ caracteres)* | Llave secreta para JWT |
   | `DATABASE_URL` | `postgresql://postgres...` | Cadena de conexión de Supabase |
   | `ML_SERVICE_URL` | `https://agropasco-ml-service.onrender.com` | URL del Microservicio ML |
5. En **Advanced** > **Health Check Path**, coloca `/api/health`.
6. Haz clic en **Create Web Service**.

---

## 📦 Migración de Datos a Supabase

Una vez que tengas la `DATABASE_URL` de Supabase, puedes migrar tus datos locales o de producción ejecutando:

```bash
# 1. Exportar datos de SQLite a formato portable JSON
python backend/scripts/export_sqlite.py --csv

# 2. Inicializar e importar los datos en PostgreSQL Supabase
node backend/scripts/migrate_to_pg.js --clean --url "TU_DATABASE_URL_DE_SUPABASE"

# 3. Validar la integridad y consistencia de la base de datos
node backend/scripts/validate_migration.js --url "TU_DATABASE_URL_DE_SUPABASE"
```

---

## ✅ Verificación Posterior al Despliegue

1. **Estado del Microservicio ML:**
   ```bash
   curl https://tu-servicio-ml.onrender.com/health
   # Respuesta esperada: {"status":"ok","service":"AgroPasco ML Service",...}
   ```
2. **Estado de los Modelos Entrenados:**
   ```bash
   curl https://tu-servicio-ml.onrender.com/models/status
   # Respuesta: {"frost":{"available":true,...},"heavy_rain":{"available":true,...},"snow":{"available":true,...}}
   ```
3. **Salud de la Plataforma Node.js + Base de Datos:**
   ```bash
   curl https://tu-plataforma.onrender.com/api/health
   # Respuesta esperada: {"status":"ok","database":"connected",...}
   ```
4. Inicia sesión en la plataforma y verifica el módulo de Machine Learning en `#/ml-monitor`.
