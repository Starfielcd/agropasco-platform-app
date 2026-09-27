"""
AgroPasco ML Service — Configuración Central
=============================================
Umbrales meteorológicos, rutas de archivos y parámetros de modelos.
Todos los umbrales están documentados y son configurables.
"""

import os
from pathlib import Path

# ===== RUTAS =====
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "weather-history"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
REPORTS_DIR = DATA_DIR / "reports"
MODELS_DIR = DATA_DIR / "models"

# Crear directorios si no existen
for d in [PROCESSED_DIR, REPORTS_DIR, MODELS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ===== CSV FILES (nombres reales encontrados en auditoría) =====
CSV_FILES = {
    "cerro_de_pasco": {
        "filename": "Cerro_de_Pasco _Zona_alta_ Heladas.csv",
        "location_name": "Cerro de Pasco",
        "zone": "Zona Alta / Puna",
        "province": "Pasco",
        "district": "Chaupimarca",
    },
    "yanahuanca": {
        "filename": "Yanahuanca_Daniel_Alcides_Carrión _Zona Andina.csv",
        "location_name": "Yanahuanca",
        "zone": "Zona Andina",
        "province": "Daniel Alcides Carrión",
        "district": "Yanahuanca",
    },
    "oxapampa": {
        "filename": "Oxapampa_Zona_Selva_Alta_Lluvias_e_Humedad.csv",
        "location_name": "Oxapampa",
        "zone": "Selva Alta",
        "province": "Oxapampa",
        "district": "Oxapampa",
    },
}

# ===== UMBRALES METEOROLÓGICOS (basados en criterios WMO y SENAMHI Perú) =====

# Helada meteorológica: temperatura del aire a 2m <= 0°C
# Referencia: WMO, SENAMHI Perú (Boletín de Heladas)
FROST_THRESHOLD_C = 0.0

# Helada severa: temperatura <= -3°C
FROST_SEVERE_THRESHOLD_C = -3.0

# Lluvia intensa: precipitación >= 20 mm/día
# Referencia: SENAMHI Perú clasifica lluvias como "fuertes" a partir de 15-20 mm/día
# Este umbral es configurable y conservador
HEAVY_RAIN_DAILY_THRESHOLD_MM = 20.0

# Lluvia muy intensa: precipitación >= 50 mm/día
VERY_HEAVY_RAIN_DAILY_THRESHOLD_MM = 50.0

# Lluvia intensa horaria: >= 10 mm/hora
HEAVY_RAIN_HOURLY_THRESHOLD_MM = 10.0

# Nieve: weather_code WMO 71-77
SNOW_WMO_CODES = [71, 73, 75, 77]

# Granizo: weather_code WMO 96-99
HAIL_WMO_CODES = [96, 99]

# Todos los códigos de precipitación (para referencia)
# 0: Clear, 1-3: Mainly clear/partly cloudy/overcast
# 45-48: Fog, 51-57: Drizzle, 61-67: Rain, 71-77: Snow, 80-82: Rain showers
# 85-86: Snow showers, 95: Thunderstorm, 96-99: Thunderstorm with hail
RAIN_WMO_CODES = [61, 63, 65, 67, 80, 81, 82]
DRIZZLE_WMO_CODES = [51, 53, 55, 57]

# ===== NIVELES DE RIESGO =====
RISK_LEVELS = {
    "none": {"label": "Sin riesgo significativo", "value": 0},
    "low": {"label": "Riesgo bajo", "value": 1},
    "moderate": {"label": "Riesgo moderado", "value": 2},
    "high": {"label": "Riesgo alto", "value": 3},
    "insufficient_data": {"label": "Datos insuficientes", "value": -1},
    "outdated": {"label": "Pronóstico desactualizado", "value": -2},
    "model_unavailable": {"label": "Modelo no disponible", "value": -3},
}

# ===== PARÁMETROS DE MODELOS =====
# Split temporal: entrenamiento hasta 2024-12-31, validación 2025-01-01 a 2025-06-30, test desde 2025-07-01
TRAIN_END_DATE = "2024-12-31"
VAL_END_DATE = "2025-06-30"
# Todo posterior a VAL_END_DATE es test

RANDOM_STATE = 42

# ===== OPEN-METEO API =====
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_HISTORICAL_URL = "https://archive-api.open-meteo.com/v1/archive"

# Variables de pronóstico a solicitar
FORECAST_HOURLY_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "weather_code",
    "wind_speed_10m",
    "cloud_cover",
    "dew_point_2m",
    "surface_pressure",
    "soil_moisture_0_to_7cm",
]

FORECAST_DAILY_VARS = [
    "temperature_2m_max",
    "temperature_2m_min",
    "temperature_2m_mean",
    "precipitation_sum",
    "rain_sum",
    "snowfall_sum",
    "wind_speed_10m_max",
    "et0_fao_evapotranspiration",
    "precipitation_probability_max",
]

# ===== ML SERVICE =====
ML_SERVICE_HOST = os.environ.get("ML_SERVICE_HOST", "127.0.0.1")
ML_SERVICE_PORT = int(os.environ.get("ML_SERVICE_PORT", "8100"))
