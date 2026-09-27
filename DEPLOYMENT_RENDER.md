# 🚀 Guía de Despliegue en Render — AgroPasco con Módulo de Machine Learning

Esta guía detalla el procedimiento para desplegar la arquitectura completa de AgroPasco en [Render](https://render.com).

---

## 🏗️ Arquitectura en Producción

El sistema se compone de dos servicios desacoplados:

1. **`agropasco-ml-service` (Web Service Python / FastAPI):**
   - Inferencia meteorológica, ejecución de modelos serializados (`.joblib`), cálculo de puntajes de riesgo y degradación a reglas heurísticas.
   - Puerto interno: `8100` o asignado dinámicamente por `$PORT`.
2. **`agropasco-platform` (Web Service Node.js / Express):**
   - API REST, autenticación JWT, RBAC multitenant, control de parcelas, notificaciones y servidor de la SPA frontend.
   - Disco persistente montado en `/var/data` para SQLite (`agropasco.db`).

---

## 🛠️ Método 1: Despliegue Automático con `render.yaml` (Recomendado)

El repositorio incluye [`render.yaml`](./render.yaml).

1. Inicia sesión en [Render Dashboard](https://dashboard.render.com).
2. Haz clic en **New +** y selecciona **Blueprint**.
3. Conecta tu repositorio de GitHub `agropasco-platform`.
4. Render detectará automáticamente [`render.yaml`](./render.yaml) y creará los dos servicios.
5. Haz clic en **Apply**. Render compilará e iniciará ambos servicios conectándolos automáticamente mediante `ML_SERVICE_URL`.

---

## 🛠️ Método 2: Despliegue Manual (Paso a Paso)

### Paso 1: Desplegar el Microservicio ML (`agropasco-ml-service`)

1. En Render, haz clic en **New +** > **Web Service**.
2. Conecta tu repositorio.
3. Configura los parámetros:
   - **Name:** `agropasco-ml-service`
   - **Region:** `Oregon (US West)` (o la más cercana)
   - **Root Directory:** `backend/ml-service`
   - **Runtime:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app:app --host 0.0.0.0 --port $PORT`
   - **Plan:** `Free` o `Starter`
4. En **Advanced** > **Health Check Path**, coloca `/health`.
5. Haz clic en **Create Web Service**.
6. Una vez desplegado, copia la URL asignada por Render:
   - Ejemplo: `https://agropasco-ml-service.onrender.com`

---

### Paso 2: Desplegar la Plataforma Principal (`agropasco-platform`)

1. En Render, haz clic en **New +** > **Web Service**.
2. Conecta tu repositorio.
3. Configura los parámetros:
   - **Name:** `agropasco-platform`
   - **Region:** La misma región del microservicio ML.
   - **Root Directory:** *(dejar en blanco para usar la raíz)*
   - **Runtime:** `Node`
   - **Build Command:** `npm install && cd backend && npm install`
   - **Start Command:** `cd backend && node server.js`
   - **Plan:** `Starter` *(requerido si se utiliza Persistent Disk)*
4. En **Environment Variables**, añade:
   | Variable | Valor | Descripción |
   | :--- | :--- | :--- |
   | `NODE_ENV` | `production` | Modo de producción |
   | `JWT_SECRET` | *(Generar cadena aleatoria de 32+ caracteres)* | Secreto para firmas JWT |
   | `ML_SERVICE_URL` | `https://agropasco-ml-service.onrender.com` | URL del Servicio 1 |
   | `DB_PATH` | `/var/data/agropasco.db` | Ruta persistente de SQLite |
5. En **Disks** (si utilizas plan Starter):
   - **Name:** `agropasco-data`
   - **Mount Path:** `/var/data`
   - **Size:** `1 GB`
6. En **Advanced** > **Health Check Path**, coloca `/api/health`.
7. Haz clic en **Create Web Service**.

---

## 🔒 Consideraciones Críticas de Persistencia (SQLite en Render)

- **Capa Gratuita (Free Tier):** Los contenedores gratuitos tienen un sistema de archivos efímero que se reinicia cuando el servicio entra en suspensión por inactividad o ante un nuevo despliegue.
- **Producción Permanente:** Se recomienda utilizar un **Persistent Disk** en Render montado en `/var/data`, o migrar a **Render PostgreSQL** cambiando el driver en [`backend/config/database.js`](./backend/config/database.js).

---

## ✅ Verificación Posterior al Despliegue

1. Comprueba el estado del microservicio ML:
   ```bash
   curl https://tu-servicio-ml.onrender.com/health
   # Respuesta esperada: {"status":"ok","service":"AgroPasco ML Service",...}
   ```
2. Comprueba el estado de los modelos:
   ```bash
   curl https://tu-servicio-ml.onrender.com/models/status
   # Respuesta esperada: {"frost":{"available":true,...},"heavy_rain":{"available":true,...}}
   ```
3. Comprueba el backend Node.js:
   ```bash
   curl https://tu-plataforma.onrender.com/api/health
   # Respuesta esperada: {"status":"ok","timestamp":...}
   ```
4. Inicia sesión en la plataforma y navega a `#/ml-monitor` para verificar que el panel muestre `⚡ Servicio ML Activo` y las tarjetas de predicción de parcelas.
