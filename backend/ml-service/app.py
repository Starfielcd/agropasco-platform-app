"""
AgroPasco ML Service — API de Inferencia (FastAPI)
===================================================
Endpoints para predicción de riesgos meteorológicos por parcela.
Se comunica con el backend Node.js para proporcionar predicciones ML.

Endpoints:
  GET  /health              — Estado del servicio
  POST /predict             — Predicción para una parcela (recibe forecast data)
  GET  /models/status       — Estado de todos los modelos
  GET  /models/{phenomenon} — Info detallada de un modelo
"""

import json
import os
import sys
import numpy as np
import pandas as pd
import joblib
import httpx
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import (
    MODELS_DIR, ML_SERVICE_HOST, ML_SERVICE_PORT,
    OPEN_METEO_FORECAST_URL, FORECAST_HOURLY_VARS, FORECAST_DAILY_VARS,
    FROST_THRESHOLD_C, FROST_SEVERE_THRESHOLD_C,
    HEAVY_RAIN_DAILY_THRESHOLD_MM,
    SNOW_WMO_CODES, HAIL_WMO_CODES,
    RISK_LEVELS,
)


# ===== Global model registry =====
models = {}
model_metadata = {}


def load_models():
    """Carga todos los modelos entrenados disponibles."""
    global models, model_metadata
    
    for phenomenon_dir in MODELS_DIR.iterdir():
        if not phenomenon_dir.is_dir():
            continue
        
        phenomenon = phenomenon_dir.name
        model_path = phenomenon_dir / "model.joblib"
        meta_path = phenomenon_dir / "metadata.json"
        
        if not model_path.exists():
            continue
        
        try:
            model = joblib.load(model_path)
            meta = {}
            if meta_path.exists():
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            
            scaler = None
            scaler_path = phenomenon_dir / "scaler.joblib"
            if scaler_path.exists() and meta.get("requires_scaler", False):
                scaler = joblib.load(scaler_path)
            
            models[phenomenon] = {
                "model": model,
                "scaler": scaler,
                "features": meta.get("features", []),
                "metadata": meta,
            }
            model_metadata[phenomenon] = meta
            print(f"  ✅ Modelo cargado: {phenomenon} ({meta.get('model_type', 'unknown')})")
        except Exception as e:
            print(f"  ❌ Error cargando modelo {phenomenon}: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Carga modelos al iniciar el servidor."""
    print("\n🔬 AgroPasco ML Service — Cargando modelos...")
    load_models()
    print(f"  Modelos disponibles: {list(models.keys())}")
    yield
    print("🔬 ML Service apagado.")


app = FastAPI(
    title="AgroPasco ML Service",
    description="API de predicción de riesgos meteorológicos agrícolas",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===== Request/Response Models =====

class ParcelForecastRequest(BaseModel):
    """Solicitud de predicción para una parcela."""
    parcel_id: int
    parcel_name: str = ""
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    altitude_masl: Optional[int] = None
    crop_type: Optional[str] = None
    # Forecast data can be provided or fetched
    forecast_data: Optional[dict] = None


class RiskPrediction(BaseModel):
    """Resultado de predicción de riesgo para un fenómeno."""
    phenomenon: str
    risk_level: str
    risk_score: float
    confidence_note: str
    model_type: str  # "ml_trained", "rule_based", "not_available"
    variables_used: dict = {}
    period: str = ""
    limitations: list = []


class PredictionResponse(BaseModel):
    """Respuesta completa de predicción."""
    parcel_id: int
    parcel_name: str
    latitude: float
    longitude: float
    altitude_masl: Optional[int]
    predictions: list
    forecast_summary: dict = {}
    issued_at: str
    valid_until: str
    data_source: str
    coverage_warning: Optional[str] = None


# ===== Helper Functions =====

async def fetch_forecast(lat: float, lon: float, days: int = 3):
    """Consulta el pronóstico de Open-Meteo para coordenadas dadas."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join(FORECAST_HOURLY_VARS),
        "daily": ",".join(FORECAST_DAILY_VARS),
        "timezone": "America/Lima",
        "forecast_days": days,
    }
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            response = await client.get(OPEN_METEO_FORECAST_URL, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Timeout consultando Open-Meteo API")
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Error de Open-Meteo: {e.response.status_code}")
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Error consultando pronóstico: {str(e)}")


def prepare_forecast_features(forecast_data, altitude_masl=None):
    """
    Prepara las variables del pronóstico en el formato esperado por los modelos.
    Retorna un DataFrame con una fila por día pronosticado.
    """
    daily = forecast_data.get("daily", {})
    hourly = forecast_data.get("hourly", {})
    elevation = forecast_data.get("elevation", 0)
    
    if not daily or not daily.get("time"):
        return pd.DataFrame()
    
    n_days = len(daily["time"])
    
    df = pd.DataFrame({
        "time": pd.to_datetime(daily["time"]),
        "temperature_2m_max": daily.get("temperature_2m_max", [None] * n_days),
        "temperature_2m_min": daily.get("temperature_2m_min", [None] * n_days),
        "temperature_2m_mean": daily.get("temperature_2m_mean", [None] * n_days),
        "precipitation_sum": daily.get("precipitation_sum", [None] * n_days),
        "rain_sum": daily.get("rain_sum", [None] * n_days),
        "wind_speed_10m_max": daily.get("wind_speed_10m_max", [None] * n_days),
        "et0_fao_evapotranspiration": daily.get("et0_fao_evapotranspiration", [None] * n_days),
    })
    
    # Temporal features
    df["month"] = df["time"].dt.month
    df["day_of_year"] = df["time"].dt.dayofyear
    df["is_winter"] = df["month"].isin([6, 7, 8]).astype(int)
    df["is_dry_season"] = df["month"].isin([5, 6, 7, 8, 9]).astype(int)
    
    # Derived
    df["temp_range"] = df["temperature_2m_max"] - df["temperature_2m_min"]
    df["elevation"] = altitude_masl if altitude_masl else elevation
    
    # Rolling & lag - use same day values for first prediction
    for window in [3, 7]:
        df[f"temp_min_rolling_{window}d"] = df["temperature_2m_min"].rolling(window, min_periods=1).mean()
        df[f"temp_max_rolling_{window}d"] = df["temperature_2m_max"].rolling(window, min_periods=1).mean()
        df[f"precip_rolling_{window}d"] = df["precipitation_sum"].rolling(window, min_periods=1).sum()
        df[f"wind_max_rolling_{window}d"] = df["wind_speed_10m_max"].rolling(window, min_periods=1).mean()
    
    df["temp_min_lag1"] = df["temperature_2m_min"].shift(1).fillna(df["temperature_2m_min"])
    df["temp_max_lag1"] = df["temperature_2m_max"].shift(1).fillna(df["temperature_2m_max"])
    df["precip_lag1"] = df["precipitation_sum"].shift(1).fillna(df["precipitation_sum"])
    
    # Hourly-derived features (aggregate from hourly forecast)
    if hourly and hourly.get("time"):
        hourly_df = pd.DataFrame(hourly)
        hourly_df["time"] = pd.to_datetime(hourly_df["time"])
        hourly_df["date"] = pd.to_datetime(hourly_df["time"].dt.date)
        
        hourly_agg = hourly_df.groupby("date").agg(
            humidity_mean=("relative_humidity_2m", "mean"),
            humidity_min=("relative_humidity_2m", "min"),
            humidity_max=("relative_humidity_2m", "max"),
            hours_below_3c=("temperature_2m", lambda x: (x <= 3.0).sum()),
            max_hourly_precip=("precipitation", "max"),
            total_precip_hours=("precipitation", lambda x: (x > 0).sum()),
        ).reset_index()
        
        hourly_agg["date"] = pd.to_datetime(hourly_agg["date"])
        
        if "soil_moisture_0_to_7cm" in hourly_df.columns:
            sm = hourly_df.groupby("date")["soil_moisture_0_to_7cm"].mean().reset_index()
            sm.columns = ["date", "soil_moisture_mean"]
            sm["date"] = pd.to_datetime(sm["date"])
            hourly_agg = hourly_agg.merge(sm, on="date", how="left")
        
        df["_merge_date"] = pd.to_datetime(df["time"].dt.date)
        df = df.merge(hourly_agg, left_on="_merge_date", right_on="date", how="left")
        for col_to_drop in ["date", "_merge_date", "key_0"]:
            if col_to_drop in df.columns:
                df.drop(columns=[col_to_drop], inplace=True)
    
    return df


def predict_with_model(phenomenon, feature_df):
    """Ejecuta predicción con un modelo entrenado."""
    if phenomenon not in models:
        return None
    
    model_info = models[phenomenon]
    model = model_info["model"]
    required_features = model_info["features"]
    scaler = model_info.get("scaler")
    
    # Check feature availability
    available = [f for f in required_features if f in feature_df.columns]
    missing = [f for f in required_features if f not in feature_df.columns]
    
    if len(available) < len(required_features) * 0.7:
        return None  # Too many missing features
    
    # Fill missing features with 0 (conservative)
    X = feature_df[available].copy()
    for feat in missing:
        X[feat] = 0
    X = X[required_features]  # Ensure correct order
    
    # Handle NaN
    X = X.fillna(X.mean())
    if X.isnull().any().any():
        X = X.fillna(0)
    
    if scaler is not None:
        X_scaled = scaler.transform(X)
    else:
        X_scaled = X
    
    predictions = model.predict(X_scaled)
    probabilities = None
    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba(X_scaled)[:, 1]
    
    return {
        "predictions": predictions.tolist(),
        "probabilities": probabilities.tolist() if probabilities is not None else None,
        "features_used": available,
        "features_missing": missing,
    }


def rule_based_risk(phenomenon, feature_df):
    """
    Evaluación basada en reglas para fenómenos sin modelo ML.
    Se identifica claramente como sistema basado en reglas.
    """
    results = []
    
    for _, row in feature_df.iterrows():
        if phenomenon == "frost":
            temp_min = row.get("temperature_2m_min", 999)
            humidity = row.get("humidity_mean", 50)
            wind = row.get("wind_speed_10m_max", 10)
            
            score = 0
            if temp_min <= -5: score += 40
            elif temp_min <= -2: score += 30
            elif temp_min <= 0: score += 20
            elif temp_min <= 3: score += 10
            
            if humidity > 85: score += 10
            if wind < 5: score += 10  # Calm winds increase frost risk
            
            level = "high" if score >= 40 else "moderate" if score >= 20 else "low" if score >= 10 else "none"
            results.append({"score": min(score, 100), "level": level})
        
        elif phenomenon == "heavy_rain":
            precip = row.get("precipitation_sum", 0)
            humidity = row.get("humidity_mean", 50)
            
            score = 0
            if precip >= 50: score += 40
            elif precip >= 20: score += 25
            elif precip >= 10: score += 15
            
            if humidity > 90: score += 10
            
            level = "high" if score >= 40 else "moderate" if score >= 20 else "low" if score >= 10 else "none"
            results.append({"score": min(score, 100), "level": level})
        
        elif phenomenon == "snow":
            temp_min = row.get("temperature_2m_min", 999)
            precip = row.get("precipitation_sum", 0)
            elevation = row.get("elevation", 0)
            
            score = 0
            if temp_min <= 0 and precip > 0 and elevation > 4000:
                score = 30
            elif temp_min <= 2 and precip > 5 and elevation > 3500:
                score = 15
            
            level = "moderate" if score >= 30 else "low" if score >= 15 else "none"
            results.append({"score": score, "level": level})
        
        elif phenomenon == "hail":
            temp_mean = row.get("temperature_2m_mean", 15)
            precip = row.get("precipitation_sum", 0)
            humidity = row.get("humidity_max", 50)
            
            score = 0
            if precip > 10 and humidity > 85 and temp_mean > 5:
                score = 20
            if precip > 20 and humidity > 90:
                score = 30
            
            level = "moderate" if score >= 30 else "low" if score >= 15 else "none"
            results.append({"score": score, "level": level})
        
        else:
            results.append({"score": 0, "level": "none"})
    
    return results


def check_coverage_warning(lat, lon, altitude):
    """Verifica si las coordenadas están dentro de la cobertura de entrenamiento."""
    training_locations = [
        {"name": "Cerro de Pasco", "lat": -10.650263, "lon": -76.25772, "elev": 4337},
        {"name": "Yanahuanca", "lat": -10.5096655, "lon": -76.51984, "elev": 3219},
        {"name": "Oxapampa", "lat": -10.650263, "lon": -75.38394, "elev": 1817},
    ]
    
    # Check distance to nearest training location (rough calculation)
    min_dist = float("inf")
    nearest = None
    for loc in training_locations:
        dist = ((lat - loc["lat"]) ** 2 + (lon - loc["lon"]) ** 2) ** 0.5
        if dist < min_dist:
            min_dist = dist
            nearest = loc["name"]
    
    # ~0.5 degree ≈ ~55km
    if min_dist > 0.5:
        return (
            f"Esta parcela está a ~{min_dist * 111:.0f} km de la ubicación de entrenamiento "
            f"más cercana ({nearest}). Los resultados pueden tener menor fiabilidad. "
            f"El modelo fue entrenado con datos de Cerro de Pasco (4337m), "
            f"Yanahuanca (3219m) y Oxapampa (1817m)."
        )
    
    if altitude:
        elev_range = [loc["elev"] for loc in training_locations]
        if altitude < min(elev_range) - 500 or altitude > max(elev_range) + 500:
            return (
                f"La altitud de esta parcela ({altitude} msnm) está fuera del rango de "
                f"entrenamiento ({min(elev_range)}-{max(elev_range)} msnm). "
                f"Los resultados pueden tener menor fiabilidad."
            )
    
    return None


# ===== API Endpoints =====

@app.get("/health")
async def health():
    """Estado del servicio ML."""
    return {
        "status": "ok",
        "service": "AgroPasco ML Service",
        "models_loaded": list(models.keys()),
        "models_count": len(models),
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/models/status")
async def models_status():
    """Estado detallado de todos los modelos."""
    status = {}
    for phenomenon in ["frost", "heavy_rain", "snow", "hail"]:
        if phenomenon in models:
            meta = model_metadata.get(phenomenon, {})
            status[phenomenon] = {
                "available": True,
                "model_type": meta.get("model_type", "unknown"),
                "trained_at": meta.get("trained_at", "unknown"),
                "label_type": meta.get("label_type", "unknown"),
                "status": meta.get("status", "unknown"),
                "validation_metrics": meta.get("validation_metrics", {}),
                "test_metrics": meta.get("test_metrics", {}),
                "audited_metrics_without_target_leakage": meta.get("audited_metrics_without_target_leakage", None),
            }
        else:
            # Check if there's a report explaining why
            report_path = MODELS_DIR.parent / "reports" / "training_report.json"
            reason = "Modelo no entrenado"
            if report_path.exists():
                with open(report_path, "r") as f:
                    reports = json.load(f)
                if phenomenon in reports:
                    reason = reports[phenomenon].get("message", reason)
            
            status[phenomenon] = {
                "available": False,
                "fallback": "rule_based",
                "reason": reason,
            }
    
    return status


@app.get("/models/{phenomenon}")
async def model_detail(phenomenon: str):
    """Información detallada de un modelo específico."""
    if phenomenon not in model_metadata:
        raise HTTPException(status_code=404, detail=f"Modelo '{phenomenon}' no encontrado")
    return model_metadata[phenomenon]


@app.post("/predict", response_model=PredictionResponse)
async def predict(request: ParcelForecastRequest):
    """
    Genera predicciones de riesgo meteorológico para una parcela.
    
    Flujo:
    1. Obtiene pronóstico de Open-Meteo para las coordenadas
    2. Prepara variables en el formato de entrenamiento
    3. Ejecuta modelos ML disponibles
    4. Complementa con sistema de reglas para fenómenos sin modelo
    5. Retorna predicciones con transparencia sobre la fuente
    """
    # 1. Obtener pronóstico
    if request.forecast_data:
        forecast = request.forecast_data
    else:
        forecast = await fetch_forecast(request.latitude, request.longitude, days=3)
    
    # 2. Preparar features
    feature_df = prepare_forecast_features(forecast, request.altitude_masl)
    
    if feature_df.empty:
        raise HTTPException(status_code=422, detail="No se pudieron preparar variables del pronóstico")
    
    # 3. Generar predicciones para cada fenómeno
    predictions = []
    phenomena = ["frost", "heavy_rain", "snow", "hail"]
    
    for phenomenon in phenomena:
        # Intentar modelo ML primero
        ml_result = predict_with_model(phenomenon, feature_df)
        
        if ml_result is not None:
            # Usar resultado del modelo ML
            # Tomar el peor caso de los días pronosticados
            max_prob = max(ml_result["probabilities"]) if ml_result["probabilities"] else 0
            max_pred = max(ml_result["predictions"])
            
            if max_prob >= 0.7:
                level = "high"
            elif max_prob >= 0.4:
                level = "moderate"
            elif max_prob >= 0.15:
                level = "low"
            else:
                level = "none"
            
            meta = model_metadata.get(phenomenon, {})
            predictions.append(RiskPrediction(
                phenomenon=phenomenon,
                risk_level=level,
                risk_score=round(max_prob * 100, 1),
                confidence_note=(
                    f"Puntuación del modelo {meta.get('model_type', 'ML')}. "
                    f"NO es una probabilidad calibrada. "
                    f"Basado en etiquetas proxy (reglas meteorológicas)."
                ),
                model_type="ml_trained",
                variables_used={
                    feat: round(float(feature_df[feat].iloc[0]), 2)
                    for feat in ml_result["features_used"][:5]
                    if feat in feature_df.columns and pd.notna(feature_df[feat].iloc[0])
                },
                period=f"{feature_df['time'].min().strftime('%Y-%m-%d')} a {feature_df['time'].max().strftime('%Y-%m-%d')}",
                limitations=meta.get("limitations", []) if isinstance(meta, dict) else [],
            ))
        else:
            # Fallback a sistema basado en reglas
            rule_results = rule_based_risk(phenomenon, feature_df)
            max_score = max(r["score"] for r in rule_results)
            max_level = max(rule_results, key=lambda r: r["score"])["level"]
            
            predictions.append(RiskPrediction(
                phenomenon=phenomenon,
                risk_level=max_level,
                risk_score=round(max_score, 1),
                confidence_note=(
                    "Evaluación basada en reglas meteorológicas, NO en modelo ML entrenado. "
                    "Los umbrales son configurables y documentados."
                ),
                model_type="rule_based",
                variables_used={
                    k: round(float(feature_df[k].iloc[0]), 2)
                    for k in ["temperature_2m_min", "precipitation_sum", "humidity_mean"]
                    if k in feature_df.columns and pd.notna(feature_df[k].iloc[0])
                },
                period=f"{feature_df['time'].min().strftime('%Y-%m-%d')} a {feature_df['time'].max().strftime('%Y-%m-%d')}",
                limitations=[
                    "Sin modelo ML entrenado para este fenómeno.",
                    "Resultado basado en umbrales meteorológicos estándar.",
                ],
            ))
    
    # 4. Forecast summary
    daily = forecast.get("daily", {})
    forecast_summary = {}
    if daily and daily.get("time"):
        forecast_summary = {
            "days": len(daily["time"]),
            "dates": daily["time"],
            "temp_min": daily.get("temperature_2m_min", []),
            "temp_max": daily.get("temperature_2m_max", []),
            "precipitation": daily.get("precipitation_sum", []),
            "elevation_model": forecast.get("elevation", None),
        }
    
    # 5. Coverage warning
    coverage_warning = check_coverage_warning(
        request.latitude, request.longitude, request.altitude_masl
    )
    
    now = datetime.now()
    return PredictionResponse(
        parcel_id=request.parcel_id,
        parcel_name=request.parcel_name,
        latitude=request.latitude,
        longitude=request.longitude,
        altitude_masl=request.altitude_masl,
        predictions=predictions,
        forecast_summary=forecast_summary,
        issued_at=now.isoformat(),
        valid_until=(now + timedelta(hours=72)).isoformat(),
        data_source="Open-Meteo Forecast API + AgroPasco ML",
        coverage_warning=coverage_warning,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=ML_SERVICE_HOST, port=ML_SERVICE_PORT)
