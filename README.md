# 🌾 AgroPasco Platform

**Plataforma Agrícola Inteligente para la Región Pasco, Perú**

Sistema web full-stack que conecta agricultores, asesores técnicos, supermercados y administradores mediante mapas interactivos, monitoreo climático, trazabilidad digital y recomendaciones de cultivos optimizadas para zonas altoandinas (4,380 msnm).

---

## 📋 Índice

- [Arquitectura](#-arquitectura)
- [Tecnologías](#-tecnologías)
- [Instalación y Configuración Local](#-instalación-y-configuración-local)
- [Variables de Entorno](#-variables-de-entorno)
- [Integración con Google Maps API](#-integración-con-google-maps-api)
- [Roles del Sistema](#-roles-del-sistema)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [API Endpoints](#-api-endpoints)
- [Despliegue en Render](#-despliegue-en-render)

---

## Arquitectura

```
┌──────────────────────────────────────────────────────┐
│                    FRONTEND (SPA)                     │
│  HTML + CSS + JavaScript vanilla                      │
│  Leaflet.js / Google Maps JavaScript API              │
│  Hash-based Router con navegación por roles           │
├──────────────────────────────────────────────────────┤
│                    BACKEND (API REST)                  │
│  Node.js + Express.js                                 │
│  JWT Authentication + Role-based Access Control       │
│  SQLite Database                                      │
├──────────────────────────────────────────────────────┤
│                SERVICIOS EXTERNOS                     │
│  Google Maps API / Leaflet + OSM (mapas)              │
│  Nominatim / Google Geocoding (geocodificación)       │
│  OSRM / Google Routes (cálculo de rutas)              │
│  Open-Meteo (clima y alertas)                         │
└──────────────────────────────────────────────────────┘
```

- **Frontend**: Single Page Application (SPA) sin framework. Usa un router hash-based (`#/ruta`) con renderizado dinámico por rol. Los mapas se gestionan desde `frontend/services/maps/`.
- **Backend**: API REST con Express.js. Autenticación JWT, middleware de roles, y base de datos SQLite. Las rutas están organizadas por dominio: `auth`, `crops`, `parcels`, `advisor`, `admin`, `supermarket`.

---

##  Tecnologías

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Runtime | Node.js | 18+ |
| Framework | Express.js | 5.x |
| Base de datos | SQLite3 | 6.x |
| Autenticación | JWT (jsonwebtoken) | 9.x |
| Seguridad | Helmet + bcryptjs | 8.x / 3.x |
| Mapas (gratuito) | Leaflet.js + OpenStreetMap | 1.9.4 |
| Mapas (pago) | Google Maps JavaScript API | Latest |
| Geocodificación | Nominatim / Google Geocoding | — |
| Rutas | OSRM / Google Routes | — |
| Clima | Open-Meteo API | — |

---

##  Instalación y Configuración Local

### Requisitos previos

- **Node.js** v18 o superior
- **npm** v9 o superior
- **Git**

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/agropasco-platform.git
cd agropasco-platform
```

### 2. Instalar dependencias

```bash
# Desde la raíz del proyecto (instala backend automáticamente)
npm install

# O manualmente:
cd backend
npm install
cd ..
```

### 3. Configurar variables de entorno

```bash
# Copiar el archivo de ejemplo
cp backend/.env.example backend/.env

# Editar con tus claves reales
nano backend/.env   # o abre con tu editor preferido
```

> **Nota:** El archivo `.env` está protegido en `.gitignore` y nunca se sube al repositorio. Usa `.env.example` como referencia.

### 4. Iniciar el servidor

```bash
# Modo producción
npm start

# Modo desarrollo (con hot-reload)
cd backend && npm run dev
```

### 5. Acceder a la plataforma

Abre tu navegador en: **http://localhost:5000**

---

##  Variables de Entorno

El archivo `backend/.env` contiene la configuración sensible del servidor. Referencia: [`backend/.env.example`](backend/.env.example)

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | `5000` |
| `NODE_ENV` | Entorno de ejecución | `development` / `production` |
| `JWT_SECRET` | Clave secreta para tokens JWT | `mi_clave_secreta_segura` |
| `WEATHER_API_KEY` | API key de OpenWeatherMap (opcional) | `abc123...` |
| `DEFAULT_LAT` | Latitud por defecto (Cerro de Pasco) | `-10.6868` |
| `DEFAULT_LON` | Longitud por defecto | `-76.2625` |
| `DEFAULT_CITY` | Ciudad por defecto | `Cerro de Pasco,PE` |
| `DB_PATH` | Ruta de la base de datos SQLite | `./agropasco.db` |
| `MAPS_API_KEY` | API key de Google Maps (opcional) | `AIzaSy...` |
| `MAPS_PROVIDER` | Proveedor de mapas | `leaflet` / `google` |

---

##  Integración con Google Maps API

El sistema soporta **dos proveedores de mapas**, configurables desde `.env`:

### Opción 1: Leaflet + OpenStreetMap (Gratuito — por defecto)

```env
MAPS_PROVIDER=leaflet
MAPS_API_KEY=
```

Usa las siguientes tecnologías **100% gratuitas**:

| Servicio | Proveedor | Función |
|----------|-----------|---------|
| Mapas interactivos | **Leaflet.js** + OpenStreetMap | Renderizado de mapas con capas |
| Vista satelital | **Esri World Imagery** | Capa satelital gratuita |
| Dibujo de polígonos | **Leaflet.Draw** | Delimitación de parcelas |
| Geocodificación | **Nominatim** (OpenStreetMap) | Coordenadas ↔ direcciones |
| Cálculo de rutas | **OSRM** | Rutas de recogida optimizadas |

### Opción 2: Google Maps JavaScript API (Servicio de pago)

```env
MAPS_PROVIDER=google
MAPS_API_KEY=AIzaSy_tu_clave_aqui
```

Requiere una cuenta activa en [Google Cloud Console](https://console.cloud.google.com/) con las siguientes APIs habilitadas:

| API de Google | Función en AgroPasco |
|--------------|---------------------|
| **Maps JavaScript API** | Renderizado de mapa interactivo |
| **Geocoding API** | Convertir coordenadas a direcciones |
| **Directions API** | Cálculo de rutas logísticas |

> **Importante:** Google Maps API es un servicio de pago. Google ofrece $200 USD/mes de crédito gratuito, suficiente para desarrollo y pruebas. Consulta la [documentación de precios](https://developers.google.com/maps/billing/gmp-billing).

### Arquitectura del servicio de mapas

```
frontend/services/maps/
├── config.js        → Configuración central (proveedor, API keys, constantes)
├── leafletMap.js    → Clase AgroMap: mapas, polígonos, marcadores (Leaflet)
├── geocoding.js     → Geocodificación: Nominatim (gratis) / Google Geocoding
└── routing.js       → Rutas: OSRM (gratis) / Google Directions
```

La selección del proveedor es **automática**: el frontend consulta `GET /api/config/maps` al iniciar y usa Google Maps si `MAPS_PROVIDER=google` y la clave está configurada; de lo contrario, usa Leaflet/OSM.

---

##  Roles del Sistema

| Rol | Funcionalidades |
|-----|----------------|
|  **Agricultor** (`farmer`) | Dibujar polígonos en mapa satelital, registrar parcelas y cultivos, alertas climáticas, trazabilidad digital |
|  **Asesor Técnico** (`advisor`) | Visualizar todas las parcelas de Pasco, marcadores georreferenciados de plagas con fotos, emitir recomendaciones técnicas |
|  **Supermercado** (`supermarket`) | Catálogo de productos, trazabilidad del origen, rutas de recogida optimizadas, gestión de inventario |
|  **Administrador** (`admin`) | Gestión de usuarios y roles, log de auditoría, estadísticas del sistema, control de APIs externas |

> El rol **admin** no puede registrarse desde el formulario público. Debe ser asignado por otro administrador.

---

##  Estructura del Proyecto

```
agropasco-platform/
├── index.html                          # Entry point del SPA
├── package.json                        # Scripts de arranque (npm start)
├── .gitignore                          # Protección de archivos sensibles
├── README.md                           # Esta documentación
│
├── backend/
│   ├── .env                            # Variables de entorno (NO se sube a Git)
│   ├── .env.example                    # Plantilla de variables de entorno
│   ├── package.json                    # Dependencias del backend
│   ├── server.js                       # Servidor Express + rutas
│   ├── config/
│   │   └── database.js                 # Esquema SQLite + inicialización
│   ├── middleware/
│   │   └── auth.js                     # JWT auth + role-based access
│   ├── controllers/
│   │   ├── authController.js           # Registro, login, perfil
│   │   ├── cropController.js           # CRUD de cultivos
│   │   ├── parcelController.js         # CRUD de parcelas (GeoJSON)
│   │   ├── advisorController.js        # Marcadores plagas + recomendaciones
│   │   ├── adminController.js          # Usuarios, auditoría, stats
│   │   └── supermarketController.js    # Productos, trazabilidad
│   ├── routes/
│   │   ├── auth.js, crops.js, parcels.js
│   │   ├── advisor.js, admin.js
│   │   ├── supermarket.js, weather.js
│   │   ├── advisory.js, ai.js
│   │   └── ...
│   └── services/
│       └── weatherService.js           # Integración Open-Meteo
│
├── frontend/
│   ├── css/
│   │   └── styles.css                  # Sistema de diseño completo (dark theme)
│   ├── js/
│   │   ├── app.js                      # Router SPA + sidebar por rol
│   │   ├── api.js                      # Cliente HTTP centralizado
│   │   ├── auth.js                     # Manejo de sesión (JWT)
│   │   ├── dashboard.js                # Panel principal
│   │   ├── crops.js                    # Gestión de cultivos
│   │   ├── weather.js                  # Clima y alertas
│   │   ├── advisory.js                 # Asesoría agrícola
│   │   ├── traceability.js             # Trazabilidad digital
│   │   ├── supermarket.js              # Catálogo de productos
│   │   ├── parcels.js                  # Mapa del agricultor (polígonos)
│   │   ├── advisor-panel.js            # Panel del asesor técnico
│   │   ├── logistics.js                # Rutas logísticas (supermercado)
│   │   └── admin-panel.js              # Panel de administración
│   └── services/
│       └── maps/
│           ├── config.js               # Configuración de mapas
│           ├── leafletMap.js            # Clase AgroMap (Leaflet)
│           ├── geocoding.js            # Geocodificación (Nominatim/Google)
│           └── routing.js              # Rutas (OSRM/Google)
```

---

##  API Endpoints

### Autenticación
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/auth/register` | Registrar usuario |
| POST | `/api/auth/login` | Iniciar sesión |
| GET | `/api/auth/me` | Perfil del usuario autenticado |

### Parcelas (farmer/advisor)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/parcels` | Listar parcelas |
| POST | `/api/parcels` | Crear parcela con polígono GeoJSON |
| GET | `/api/parcels/:id` | Detalle de parcela |
| PUT | `/api/parcels/:id` | Actualizar parcela |
| DELETE | `/api/parcels/:id` | Eliminar parcela |

### Asesor Técnico
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/advisor/markers` | Listar marcadores de plagas |
| POST | `/api/advisor/markers` | Crear marcador georreferenciado |
| PUT | `/api/advisor/markers/:id/resolve` | Marcar plaga como resuelta |
| GET | `/api/advisor/recommendations` | Listar recomendaciones |
| POST | `/api/advisor/recommendations` | Emitir recomendación técnica |

### Administración
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/admin/users` | Listar usuarios |
| PUT | `/api/admin/users/:id/role` | Cambiar rol de usuario |
| DELETE | `/api/admin/users/:id` | Eliminar usuario |
| GET | `/api/admin/audit` | Log de auditoría |
| GET | `/api/admin/stats` | Estadísticas del sistema |

### Configuración
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/config/maps` | Configuración de mapas (público) |
| GET | `/api` | Documentación completa de la API |

---

##  Despliegue en Render

La plataforma está preparada para despliegue en [Render](https://render.com/) como **Web Service**.

### Paso 1: Subir cambios a GitHub

```bash
# Agregar todos los cambios
git add .

# Crear commit descriptivo
git commit -m "feat: actualización de roles y mapas"

# Subir al repositorio remoto
git push origin main
```

### Paso 2: Configurar en Render

1. Crear un **New Web Service** en [dashboard.render.com](https://dashboard.render.com/).
2. Conectar el repositorio de GitHub.
3. Configurar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** `Node`
4. Agregar las **variables de entorno** en la pestaña "Environment":
   - `PORT` → `5000`
   - `NODE_ENV` → `production`
   - `JWT_SECRET` → `(tu clave secreta segura)`
   - `MAPS_PROVIDER` → `google` o `leaflet`
   - `MAPS_API_KEY` → `(tu API key de Google Maps, si aplica)`
   - `DB_PATH` → `./agropasco.db`

### Paso 3: Desplegar

- **Deploy automático:** Cada `git push` a `main` dispara un redeploy.
- **Deploy manual:** Dashboard → Manual Deploy → **Deploy latest commit**.

### Paso 4: Verificar

1. Revisar **Logs** en el dashboard de Render para confirmar inicio exitoso.
2. Abrir la URL pública (ej: `https://agropasco-platform.onrender.com`).
3. Probar el endpoint `/api` para verificar que la API responde.
4. Registrar un usuario y verificar el login.

---

##  Licencia

Proyecto académico — Universidad Nacional Daniel Alcides Carrión, Pasco, Perú.
