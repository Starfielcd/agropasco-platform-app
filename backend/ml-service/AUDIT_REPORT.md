# 📋 INFORME DE AUDITORÍA TÉCNICA Y VALIDACIÓN REAL: MÓDULO MACHINE LEARNING AGROPASCO

**Fecha de Auditoría:** 27 de Septiembre de 2026  
**Auditor:** Ingeniero Senior de Machine Learning & Auditor de Software  
**Estado General del Módulo:** **Funcional con limitaciones metodológicas documentadas (Etiquetas Proxy y Emulación NWP)**  

---

## 1. REQUISITOS CUMPLIDOS CON EVIDENCIA VERIFICABLE

| Requisito | Evidencia en Código | Resultado Verificado |
| :--- | :--- | :--- |
| **Integridad de CSVs Originales** | `backend/data/weather-history/raw/` | 3 archivos intactos (Cerro de Pasco 2.32 MB, Oxapampa 2.40 MB, Yanahuanca 2.35 MB). Sin modificaciones. |
| **Microservicio FastAPI en Inferencia** | `backend/ml-service/app.py` | Puerto 8100 operativo, responde en `/health`, `/models/status`, `/predict`. |
| **Integración Node.js y Cache** | `backend/services/mlService.js` | Cliente HTTP con timeout de 15s, cache en SQLite con TTL de 1 hora, fallback determinista a reglas. |
| **Control de Acceso Multitenant (RBAC)** | `backend/routes/ml.js` | Rutas protegidas con JWT. Un agricultor solo puede consultar sus parcelas y alertas. 403 Forbidden para accesos no autorizados. |
| **Degradación Elegante (Fallback)** | `backend/ml-service/app.py#L300-L370` | Cuando un fenómeno no es viable (Granizo) o el servicio ML está apagado, el sistema usa reglas meteorológicas documentadas. |
| **Geometría y Centroides Automáticos** | `backend/controllers/parcelController.js#L8-L35` | Si una parcela carece de coordenadas pero tiene GeoJSON, se calcula el centroide automáticamente. |
| **Advertencia Geográfica Fuera de Pasco** | `backend/ml-service/app.py#L373-L408` | Si las coordenadas se alejan >55 km de las estaciones históricas (ej: Lima), se emite `coverage_warning`. |

---

## 2. REQUISITOS PARCIALMENTE CUMPLIDOS

1. **Predicción Meteorológica "Predictiva" vs "Emulativa":**
   - El sistema no predice el clima de forma autónoma a partir de variables atmosféricas iniciales; **consume el pronóstico numérico (NWP) de Open-Meteo a 72 horas** y aplica el modelo Random Forest o reglas como un clasificador de riesgo secundario (Model Output Statistics / Clasificador de Riesgo).
2. **Horizonte de Pronóstico:**
   - Open-Meteo entrega 72 horas (3 días). No cubre horizontes extendidos a 7 o 14 días con fiabilidad local.
3. **Calibración de Probabilidades:**
   - Las probabilidades reportadas (`predict_proba`) son proporciones de votos del ensamble Random Forest, no probabilidades calibradas mediante Platt Scaling o Isotonic Regression. Se documentan en UI como "Puntaje de Riesgo (0-100)" y no como probabilidad matemática estricta.

---

## 3. REQUISITOS PENDIENTES O NO DEMOSTRADOS

1. **Validación con Estaciones de Campo SENAMHI:**
   - Los datos provienen enteramente del reanálisis de Open-Meteo (ERA5 / ECMWF / GFS). **No se cuenta con datos de estaciones pluviométricas o termométricas físicas locales de SENAMHI en Pasco** para validar discrepancias microclimáticas de fondo de valle o puna.
2. **Modelo Supervisado de Granizo:**
   - La serie temporal histórica contiene **0 horas registradas con códigos WMO de granizo (96, 99)**. Clasificado honestamente como **NO VIABLE para Machine Learning supervisado**. Funciona 100% bajo reglas heurísticas de reflectividad/inestabilidad.
3. **Persistencia en Despliegue Cloud (Render):**
   - El proyecto actualmente se ejecuta en `localhost`. No está configurado un Dockerfile multi-servicio ni un orquestador para levantar Node.js + FastAPI de forma simultánea en la capa gratuita de Render.

---

## 4. HALLAZGOS CRÍTICOS Y CORRECCIONES REALIZADAS

### Hallazgo 1: Target Leakage (Filtración del Objetivo) en F1 = 1.000
- **Diagnóstico:** El reporte preliminar afirmaba un rendimiento perfecto de F1 = 1.000 para Heladas y Lluvias Intensas. 
- **Causa Raíz:** En `data_processor.py`, la etiqueta de helada se definió como `y = (temperature_2m_min <= 0)`. Sin embargo, en `model_trainer.py`, `temperature_2m_min` se incluyó dentro de `FROST_FEATURES` como predictor de entrada. El Random Forest simplemente memorizó la condición `temperature_2m_min <= 0`, generando un F1 de 1.000 trivial.
- **Auditoría Experimental Real:**
  * Al evaluar el modelo **excluyendo la variable filtrada** (usando únicamente predictores independientes: temperatura media, máxima, rangos térmicos, humedad, estacionalidad, elevación y promedios móviles):
    - **Heladas:** F1 real = **0.8563** | Precision = **0.8278** | Recall = **0.8869** | PR-AUC = **0.9400**.
    - **Lluvias Intensas:** F1 real = **0.6822** | Precision = **0.7857** | Recall = **0.6027** | PR-AUC = **0.7819**.
- **Corrección:** Se actualizaron los metadatos oficiales en `frost/metadata.json` y `heavy_rain/metadata.json`, y se ajustó la interfaz `ml-monitor.js` para mostrar los valores auditados independientes.

### Hallazgo 2: Error de Zona Horaria en la Expiración de Caché SQLite
- **Diagnóstico:** En `mlService.js`, SQLite almacena `fetched_at` en UTC (`YYYY-MM-DD HH:MM:SS`), pero `new Date(row.fetched_at)` en Windows (Zona Lima GMT-5) interpretaba la cadena en hora local, calculando edades negativas (-187 minutos) y provocando comportamientos erráticos de caché.
- **Corrección:** Se normalizó la cadena a ISO-8601 UTC (`+ 'Z'`) garantizando que la edad del caché se evalúe exactamente sobre el tiempo transcurrido en milisegundos.

### Hallazgo 3: Omisión de Alertas para Agricultores con Múltiples Parcelas
- **Diagnóstico:** En `mlController.js`, el filtro de prevención de duplicados verificaba únicamente `WHERE user_id = ? AND type = ?`. Si un agricultor tenía dos parcelas distintas en riesgo de helada (ej. Ninacaca y Yanahuanca), la segunda quedaba omitida.
- **Corrección:** Se modificó la consulta para verificar duplicados por parcela específica (`AND title LIKE ?` conteniendo el nombre de la parcela).

### Hallazgo 4: Falta de Endpoints de Alertas para el Agricultor
- **Diagnóstico:** Las alertas se guardaban en la tabla `notifications`, pero no existían rutas en `/api/ml` para que el agricultor pudiera consultarlas y marcarlas como leídas.
- **Corrección:** Se implementaron y protegieron `GET /api/ml/alerts` y `PUT /api/ml/alerts/:id/read`.

---

## 5. AUDITORÍA DETALLADA DE LOS CSV ORIGINALES

Los 3 archivos ubicados en `backend/data/weather-history/raw/` fueron auditados mediante análisis sintáctico y estadístico directo:

| Parámetro | Cerro de Pasco (Zona Alta) | Yanahuanca (Zona Andina) | Oxapampa (Selva Alta) |
| :--- | :--- | :--- | :--- |
| **Nombre Exacto** | `Cerro_de_Pasco _Zona_alta_ Heladas.csv` | `Yanahuanca_Daniel_Alcides_Carrión _Zona Andina.csv` | `Oxapampa_Zona_Selva_Alta_Lluvias_e_Humedad.csv` |
| **Tamaño en Disco** | 2,327,267 bytes | 2,354,500 bytes | 2,403,426 bytes |
| **Coordenadas Reales** | -10.650263, -76.257720 | -10.5096655, -76.519840 | -10.650263, -75.383940 |
| **Elevación Registrada**| 4,337.0 msnm | 3,219.0 msnm | 1,817.0 msnm |
| **Filas Horarias** | 59,064 registros | 59,064 registros | 59,064 registros |
| **Filas Diarias** | 2,461 registros | 2,461 registros | 2,461 registros |
| **Periodo Temporal** | 2020-01-01T00:00 a 2026-09-26T23:00 | 2020-01-01T00:00 a 2026-09-26T23:00 | 2020-01-01T00:00 a 2026-09-26T23:00 |
| **Valores Nulos** | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) |
| **Filas Duplicadas** | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) |
| **Códigos WMO Presentes**| 0, 1, 2, 3, 51, 53, 55, 61, 63, 71, 73, 75 | 0, 1, 2, 3, 51, 53, 55, 61, 63, 71, 73, 75 | 0, 1, 2, 3, 51, 53, 55, 61, 63, 65 |
| **Horas con Granizo (WMO 96-99)** | **0 horas** | **0 horas** | **0 horas** |
| **Días con Helada (min<=0°C)** | 940 días (38.2%) | 62 días (2.52%) | 0 días (0.0%) |
| **Días con Lluvia (>=20mm)** | 6 días (0.24%) | 8 días (0.33%) | 422 días (17.15%) |

---

## 6. RESULTADOS REALES Y VERIFICADOS DE LOS MODELOS

### Resumen de Métricas Auditadas (Conjunto de Test Temporal: > 2025-06-30, 1,359 muestras)

| Fenómeno | Algoritmo | Precision | Recall | F1-Score | PR-AUC | Matriz de Confusión (Test) | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Heladas** | Random Forest (100 estimators) | 0.8278 | 0.8869 | **0.8563** | 0.9400 | `TN: 1160, FP: 31`<br>`FN: 19, TP: 149` | 🟢 Entrenado y Auditado |
| **Lluvias Intensas** | Random Forest (100 estimators) | 0.7857 | 0.6027 | **0.6822** | 0.7819 | `TN: 1274, FP: 12`<br>`FN: 29, TP: 44` | 🟢 Entrenado y Auditado |
| **Nevada** | Random Forest (100 estimators) | 0.9000 | 0.7934 | **0.8433** | 0.9372 | `TN: 511, FP: 32`<br>`FN: 75, TP: 288` | 🟢 Entrenado (Proxy WMO) |
| **Granizo** | Reglas Físicas Deterministas | N/A | N/A | N/A | N/A | Reglas: Temp > 5°C, Hum > 85%, Precip > 10mm | 🟡 Reglas (Datos Insuficientes) |

---

## 7. RESULTADOS DE LAS PRUEBAS AUTOMATIZADAS

### Suite 1: Python ML Service (`test_ml_audit.py`)
- **Comando:** `python -X utf8 test_ml_audit.py`
- **Resultado:** **9/9 TESTS PASSED (OK)** en 3.768s.

### Suite 2: Node.js Integración y Seguridad (`test_ml_integration_and_auth.js`)
- **Comando:** `node backend/tests/test_ml_integration_and_auth.js`
- **Resultado:** **15/15 TESTS PASSED (0 FAILED)**.

---

## 8. CATÁLOGO DE ENDPOINTS EXISTENTES

| Método | Endpoint | Rol Mínimo | Descripción | Estado |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/ml/predict/:parcelId` | `farmer` (propietario), `advisor`, `admin` | Inferencia ML para una parcela específica con fallback a reglas. | 🟢 Activo |
| `GET` | `/api/ml/predictions` | `farmer` | Predicciones de todas las parcelas activas del usuario autenticado. | 🟢 Activo |
| `GET` | `/api/ml/predictions/all` | `advisor`, `admin` | Predicciones consolidadas de todas las parcelas de Pasco. | 🟢 Activo |
| `GET` | `/api/ml/models/status` | Cualquiera autenticado | Estado de los 4 modelos y métricas auditadas. | 🟢 Activo |
| `GET` | `/api/ml/alerts` | `farmer` | Alertas climáticas dirigidas al usuario autenticado. | 🟢 Activo |
| `PUT` | `/api/ml/alerts/:id/read` | `farmer` (propietario) | Marca una alerta propia como leída. | 🟢 Activo |
| `POST`| `/api/ml/alerts/generate` | `admin` | Dispara el análisis masivo y generación de notificaciones. | 🟢 Activo |
| `GET` | `/api/ml/admin/dashboard` | `admin` | Resumen de salud ML, parcelas activas y alertas emitidas en 24h. | 🟢 Activo |

---

## 9. LIMITACIONES DE COBERTURA Y FIABILIDAD METEOROLÓGICA

1. **Dependencia de la API de Open-Meteo:** Caídas de red degradan a fallback por reglas.
2. **Representatividad Geográfica:** 3 coordenadas históricas no cubren todos los microclimas de Pasco.
3. **Granizo Indetectable por ML:** Ausencia de registros en reanálisis global.

---

## 10. DIAGNÓSTICO Y GUÍA DE DESPLIEGUE EN RENDER

- Configurar dos Web Services en Render:
  * Servicio 1 (Python): `uvicorn app:app --host 0.0.0.0 --port $PORT` en `backend/ml-service`.
  * Servicio 2 (Node): `node server.js` en `backend` con `ML_SERVICE_URL`.
- Configurar base de datos persistente (Render Disk en `/var/data` o PostgreSQL).
