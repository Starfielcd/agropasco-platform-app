"""
AgroPasco ML Service — Procesador de Datos CSV
================================================
Lee los 3 CSV históricos de Open-Meteo, extrae ambas secciones (horaria y diaria),
genera informe de calidad, crea etiquetas proxy y prepara datos para entrenamiento.

IMPORTANTE: Los CSV de Open-Meteo tienen DOS secciones:
  - Sección 1 (líneas 4 a ~59068): Datos horarios
  - Sección 2 (línea ~59069 en adelante): Datos diarios
  Las primeras 2 líneas contienen metadatos (lat, lon, elevation, timezone).

Este procesador conserva los archivos originales sin alteraciones.
"""

import pandas as pd
import numpy as np
import json
import os
from datetime import datetime
from pathlib import Path
from config import (
    RAW_DIR, PROCESSED_DIR, REPORTS_DIR, CSV_FILES,
    FROST_THRESHOLD_C, FROST_SEVERE_THRESHOLD_C,
    HEAVY_RAIN_DAILY_THRESHOLD_MM, VERY_HEAVY_RAIN_DAILY_THRESHOLD_MM,
    HEAVY_RAIN_HOURLY_THRESHOLD_MM,
    SNOW_WMO_CODES, HAIL_WMO_CODES, RAIN_WMO_CODES,
    TRAIN_END_DATE, VAL_END_DATE,
)


def parse_csv_metadata(filepath):
    """Extrae metadatos de las primeras 2 líneas del CSV de Open-Meteo."""
    with open(filepath, "r", encoding="utf-8") as f:
        header_line = f.readline().strip()
        values_line = f.readline().strip()

    headers = header_line.split(",")
    values = values_line.split(",")
    meta = dict(zip(headers, values))

    return {
        "latitude": float(meta.get("latitude", 0)),
        "longitude": float(meta.get("longitude", 0)),
        "elevation": float(meta.get("elevation", 0)),
        "utc_offset_seconds": int(meta.get("utc_offset_seconds", -18000)),
        "timezone": meta.get("timezone", "America/Lima"),
        "timezone_abbreviation": meta.get("timezone_abbreviation", "GMT-5"),
    }


def find_daily_header_line(filepath):
    """Encuentra la línea donde comienza la sección de datos diarios."""
    with open(filepath, "r", encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            if "temperature_2m_max" in line and i > 10:
                return i
    return None


def read_hourly_data(filepath, daily_header_line):
    """Lee la sección de datos horarios del CSV.
    
    Note: Some CSVs have a blank line between hourly and daily sections.
    We detect this and adjust nrows accordingly.
    """
    # Read raw lines to detect blank separators
    with open(filepath, "r", encoding="utf-8") as f:
        all_lines = f.readlines()
    
    # Line 4 (1-indexed) = index 3 = hourly header
    # Data starts at line 5 = index 4
    # Find the last non-blank line before daily_header_line
    data_start_idx = 4  # 0-indexed
    data_end_idx = daily_header_line - 2  # 0-indexed, line before daily header
    
    # Skip blank lines at the end of hourly section
    while data_end_idx >= data_start_idx and all_lines[data_end_idx].strip() == "":
        data_end_idx -= 1
    
    nrows = data_end_idx - data_start_idx + 1
    
    df = pd.read_csv(
        filepath,
        skiprows=3,  # Skip metadata (2 lines) + blank line
        nrows=nrows,
        parse_dates=["time"],
    )
    
    # Limpiar nombres de columnas (quitar unidades entre paréntesis)
    df.columns = [col.split(" (")[0].strip() for col in df.columns]
    
    return df


def read_daily_data(filepath, daily_header_line):
    """Lee la sección de datos diarios del CSV."""
    df = pd.read_csv(
        filepath,
        skiprows=daily_header_line - 1,  # Skip everything up to daily header
        parse_dates=["time"],
    )
    
    # Limpiar nombres de columnas
    df.columns = [col.split(" (")[0].strip() for col in df.columns]
    
    return df


def generate_quality_report(location_key, meta, hourly_df, daily_df, csv_info):
    """Genera un informe detallado de calidad de datos para un CSV."""
    report = {
        "location_key": location_key,
        "location_name": csv_info["location_name"],
        "zone": csv_info["zone"],
        "province": csv_info["province"],
        "filename": csv_info["filename"],
        "generated_at": datetime.now().isoformat(),
        "metadata": meta,
        "hourly": {},
        "daily": {},
    }

    # --- Hourly section ---
    h = report["hourly"]
    h["num_records"] = len(hourly_df)
    h["num_columns"] = len(hourly_df.columns)
    h["columns"] = list(hourly_df.columns)
    h["dtypes"] = {col: str(hourly_df[col].dtype) for col in hourly_df.columns}
    h["date_range"] = {
        "start": str(hourly_df["time"].min()),
        "end": str(hourly_df["time"].max()),
    }
    h["frequency"] = "hourly"
    h["missing_values"] = hourly_df.isnull().sum().to_dict()
    h["duplicated_rows"] = int(hourly_df.duplicated().sum())
    h["duplicated_timestamps"] = int(hourly_df["time"].duplicated().sum())
    
    # Estadísticas descriptivas
    h["statistics"] = {}
    for col in hourly_df.select_dtypes(include=[np.number]).columns:
        h["statistics"][col] = {
            "min": float(hourly_df[col].min()) if not hourly_df[col].isnull().all() else None,
            "max": float(hourly_df[col].max()) if not hourly_df[col].isnull().all() else None,
            "mean": float(hourly_df[col].mean()) if not hourly_df[col].isnull().all() else None,
            "std": float(hourly_df[col].std()) if not hourly_df[col].isnull().all() else None,
        }

    # --- Daily section ---
    d = report["daily"]
    d["num_records"] = len(daily_df)
    d["num_columns"] = len(daily_df.columns)
    d["columns"] = list(daily_df.columns)
    d["dtypes"] = {col: str(daily_df[col].dtype) for col in daily_df.columns}
    d["date_range"] = {
        "start": str(daily_df["time"].min()),
        "end": str(daily_df["time"].max()),
    }
    d["frequency"] = "daily"
    d["missing_values"] = daily_df.isnull().sum().to_dict()
    d["duplicated_rows"] = int(daily_df.duplicated().sum())
    d["duplicated_timestamps"] = int(daily_df["time"].duplicated().sum())
    
    d["statistics"] = {}
    for col in daily_df.select_dtypes(include=[np.number]).columns:
        d["statistics"][col] = {
            "min": float(daily_df[col].min()) if not daily_df[col].isnull().all() else None,
            "max": float(daily_df[col].max()) if not daily_df[col].isnull().all() else None,
            "mean": float(daily_df[col].mean()) if not daily_df[col].isnull().all() else None,
            "std": float(daily_df[col].std()) if not daily_df[col].isnull().all() else None,
        }

    # --- Event counts (proxy labels) ---
    report["event_analysis"] = analyze_events(hourly_df, daily_df, meta)

    return report


def analyze_events(hourly_df, daily_df, meta):
    """Analiza la presencia de eventos meteorológicos en los datos."""
    events = {}

    # Heladas (basado en temperatura horaria <= 0°C)
    frost_hours = (hourly_df["temperature_2m"] <= FROST_THRESHOLD_C).sum()
    frost_days = (daily_df["temperature_2m_min"] <= FROST_THRESHOLD_C).sum()
    severe_frost_days = (daily_df["temperature_2m_min"] <= FROST_SEVERE_THRESHOLD_C).sum()
    events["frost"] = {
        "hours_below_0c": int(frost_hours),
        "days_with_min_below_0c": int(frost_days),
        "days_with_min_below_minus3c": int(severe_frost_days),
        "total_days": len(daily_df),
        "percentage_frost_days": round(float(frost_days / len(daily_df) * 100), 2) if len(daily_df) > 0 else 0,
        "label_type": "proxy_rule_based",
        "rule": f"temperature_2m_min <= {FROST_THRESHOLD_C}°C",
        "note": "Etiqueta derivada de regla meteorológica, NO de observación verificada en campo.",
    }

    # Lluvias intensas
    heavy_rain_days = (daily_df["precipitation_sum"] >= HEAVY_RAIN_DAILY_THRESHOLD_MM).sum()
    very_heavy_rain_days = (daily_df["precipitation_sum"] >= VERY_HEAVY_RAIN_DAILY_THRESHOLD_MM).sum()
    heavy_rain_hours = (hourly_df["precipitation"] >= HEAVY_RAIN_HOURLY_THRESHOLD_MM).sum()
    events["heavy_rain"] = {
        "days_above_20mm": int(heavy_rain_days),
        "days_above_50mm": int(very_heavy_rain_days),
        "hours_above_10mm": int(heavy_rain_hours),
        "total_days": len(daily_df),
        "percentage_heavy_rain_days": round(float(heavy_rain_days / len(daily_df) * 100), 2) if len(daily_df) > 0 else 0,
        "label_type": "proxy_rule_based",
        "rule": f"precipitation_sum >= {HEAVY_RAIN_DAILY_THRESHOLD_MM} mm/día",
    }

    # Nieve (basado en weather_code WMO)
    if "weather_code" in hourly_df.columns:
        snow_hours = hourly_df["weather_code"].isin(SNOW_WMO_CODES).sum()
        snow_days = 0
        if snow_hours > 0:
            hourly_df_copy = hourly_df.copy()
            hourly_df_copy["date"] = hourly_df_copy["time"].dt.date
            snow_days = hourly_df_copy[hourly_df_copy["weather_code"].isin(SNOW_WMO_CODES)]["date"].nunique()
    else:
        snow_hours = 0
        snow_days = 0
    
    events["snow"] = {
        "hours_with_snow_code": int(snow_hours),
        "days_with_snow_code": int(snow_days),
        "total_days": len(daily_df),
        "wmo_codes_used": SNOW_WMO_CODES,
        "label_type": "proxy_wmo_code",
        "note": "Basado en código WMO del modelo meteorológico, NO en observación directa.",
        "viability": "limited" if snow_days < 30 else "possible",
    }

    # Granizo
    if "weather_code" in hourly_df.columns:
        hail_hours = hourly_df["weather_code"].isin(HAIL_WMO_CODES).sum()
    else:
        hail_hours = 0
    
    events["hail"] = {
        "hours_with_hail_code": int(hail_hours),
        "wmo_codes_used": HAIL_WMO_CODES,
        "label_type": "proxy_wmo_code",
        "note": "El granizo es un fenómeno muy localizado. Datos insuficientes para ML.",
        "viability": "not_viable" if hail_hours < 10 else "experimental",
    }

    return events


def derive_daily_features_from_hourly(hourly_df):
    """
    Deriva variables diarias adicionales a partir de datos horarios.
    Estas variables enriquecen el dataset diario para el entrenamiento.
    """
    hourly = hourly_df.copy()
    hourly["date"] = hourly["time"].dt.date
    
    daily_derived = hourly.groupby("date").agg(
        humidity_mean=("relative_humidity_2m", "mean"),
        humidity_min=("relative_humidity_2m", "min"),
        humidity_max=("relative_humidity_2m", "max"),
        soil_moisture_mean=("soil_moisture_0_to_7cm", "mean"),
        hours_below_0c=("temperature_2m", lambda x: (x <= FROST_THRESHOLD_C).sum()),
        hours_below_3c=("temperature_2m", lambda x: (x <= 3.0).sum()),
        max_hourly_precip=("precipitation", "max"),
        total_precip_hours=("precipitation", lambda x: (x > 0).sum()),
        temp_range_hourly=("temperature_2m", lambda x: x.max() - x.min()),
    ).reset_index()
    
    daily_derived["date"] = pd.to_datetime(daily_derived["date"])
    
    # WMO code features
    if "weather_code" in hourly.columns:
        wmo_features = hourly.groupby("date").agg(
            snow_code_hours=("weather_code", lambda x: x.isin(SNOW_WMO_CODES).sum()),
            rain_code_hours=("weather_code", lambda x: x.isin(RAIN_WMO_CODES).sum()),
            hail_code_hours=("weather_code", lambda x: x.isin(HAIL_WMO_CODES).sum()),
        ).reset_index()
        wmo_features["date"] = pd.to_datetime(wmo_features["date"])
        daily_derived = daily_derived.merge(wmo_features, on="date", how="left")
    
    return daily_derived


def create_proxy_labels(daily_df):
    """
    Crea etiquetas proxy basadas en reglas meteorológicas documentadas.
    
    IMPORTANTE: Estas NO son observaciones verificadas en campo.
    Son etiquetas derivadas de umbrales meteorológicos estándar aplicados
    a datos de reanálisis de Open-Meteo.
    """
    labels = pd.DataFrame(index=daily_df.index)
    
    # Helada: temperatura mínima diaria <= 0°C
    labels["frost"] = (daily_df["temperature_2m_min"] <= FROST_THRESHOLD_C).astype(int)
    labels["frost_severe"] = (daily_df["temperature_2m_min"] <= FROST_SEVERE_THRESHOLD_C).astype(int)
    
    # Lluvia intensa: precipitación diaria >= umbral
    labels["heavy_rain"] = (daily_df["precipitation_sum"] >= HEAVY_RAIN_DAILY_THRESHOLD_MM).astype(int)
    labels["very_heavy_rain"] = (daily_df["precipitation_sum"] >= VERY_HEAVY_RAIN_DAILY_THRESHOLD_MM).astype(int)
    
    # Nieve: horas con código WMO de nieve > 0 (requiere datos derivados de hourly)
    if "snow_code_hours" in daily_df.columns:
        labels["snow"] = (daily_df["snow_code_hours"] > 0).astype(int)
    else:
        labels["snow"] = 0
    
    return labels


def build_features(daily_df, derived_df, meta):
    """
    Construye el conjunto de variables predictoras para los modelos.
    Incluye variables temporales, meteorológicas y de contexto.
    """
    df = daily_df.copy()
    
    # Merge derived features from hourly
    if derived_df is not None and len(derived_df) > 0:
        df = df.merge(derived_df, left_on="time", right_on="date", how="left")
        if "date" in df.columns:
            df.drop(columns=["date"], inplace=True)
    
    # --- Temporal features ---
    df["month"] = df["time"].dt.month
    df["day_of_year"] = df["time"].dt.dayofyear
    df["is_winter"] = df["month"].isin([6, 7, 8]).astype(int)  # Invierno austral
    df["is_dry_season"] = df["month"].isin([5, 6, 7, 8, 9]).astype(int)
    
    # --- Derived meteorological features ---
    df["temp_range"] = df["temperature_2m_max"] - df["temperature_2m_min"]
    
    # Rolling features calculadas exclusivamente sobre días anteriores (shift 1) para evitar fuga temporal
    for window in [3, 7]:
        df[f"temp_min_rolling_{window}d"] = df["temperature_2m_min"].shift(1).rolling(window, min_periods=1).mean()
        df[f"temp_max_rolling_{window}d"] = df["temperature_2m_max"].shift(1).rolling(window, min_periods=1).mean()
        df[f"precip_rolling_{window}d"] = df["precipitation_sum"].shift(1).rolling(window, min_periods=1).sum()
        df[f"wind_max_rolling_{window}d"] = df["wind_speed_10m_max"].shift(1).rolling(window, min_periods=1).mean()
    
    # Lag features (día anterior)
    df["temp_min_lag1"] = df["temperature_2m_min"].shift(1)
    df["temp_max_lag1"] = df["temperature_2m_max"].shift(1)
    df["precip_lag1"] = df["precipitation_sum"].shift(1)
    
    # --- Location context ---
    df["elevation"] = meta["elevation"]
    
    return df


def temporal_split(df, labels_df):
    """
    Divide los datos temporalmente para evitar filtración de información.
    - Entrenamiento: hasta TRAIN_END_DATE
    - Validación: TRAIN_END_DATE hasta VAL_END_DATE
    - Test: posterior a VAL_END_DATE
    """
    train_mask = df["time"] <= TRAIN_END_DATE
    val_mask = (df["time"] > TRAIN_END_DATE) & (df["time"] <= VAL_END_DATE)
    test_mask = df["time"] > VAL_END_DATE
    
    splits = {
        "train": {"features": df[train_mask].copy(), "labels": labels_df[train_mask].copy()},
        "val": {"features": df[val_mask].copy(), "labels": labels_df[val_mask].copy()},
        "test": {"features": df[test_mask].copy(), "labels": labels_df[test_mask].copy()},
    }
    
    return splits


def process_single_csv(location_key):
    """Procesa un solo CSV y retorna los datos preparados."""
    csv_info = CSV_FILES[location_key]
    filepath = RAW_DIR / csv_info["filename"]
    
    if not filepath.exists():
        raise FileNotFoundError(f"No se encontró el archivo: {filepath}")
    
    print(f"\n{'='*60}")
    print(f"Procesando: {csv_info['location_name']} ({csv_info['zone']})")
    print(f"Archivo: {csv_info['filename']}")
    print(f"{'='*60}")
    
    # 1. Leer metadatos
    meta = parse_csv_metadata(filepath)
    print(f"  Coordenadas: ({meta['latitude']}, {meta['longitude']})")
    print(f"  Elevación Open-Meteo: {meta['elevation']} m")
    
    # 2. Encontrar inicio de sección diaria
    daily_line = find_daily_header_line(filepath)
    if not daily_line:
        raise ValueError(f"No se encontró la sección de datos diarios en {filepath}")
    print(f"  Sección diaria encontrada en línea: {daily_line}")
    
    # 3. Leer secciones
    hourly_df = read_hourly_data(filepath, daily_line)
    daily_df = read_daily_data(filepath, daily_line)
    print(f"  Registros horarios: {len(hourly_df):,}")
    print(f"  Registros diarios: {len(daily_df):,}")
    
    # 4. Informe de calidad
    quality_report = generate_quality_report(location_key, meta, hourly_df, daily_df, csv_info)
    
    # 5. Derivar features de datos horarios
    derived_df = derive_daily_features_from_hourly(hourly_df)
    print(f"  Variables derivadas de hourly: {len(derived_df.columns)}")
    
    # 6. Construir features
    feature_df = build_features(daily_df, derived_df, meta)
    
    # 7. Crear etiquetas proxy
    labels_df = create_proxy_labels(feature_df)
    
    # 8. Limpiar NaN de lag/rolling features (primeras filas)
    feature_df = feature_df.bfill().ffill()
    
    # Imprimir resumen de eventos
    events = quality_report["event_analysis"]
    print(f"\n  --- Resumen de Eventos Proxy ---")
    print(f"  Heladas (min<=0°C): {events['frost']['days_with_min_below_0c']} días ({events['frost']['percentage_frost_days']}%)")
    print(f"  Heladas severas (min<=-3°C): {events['frost']['days_with_min_below_minus3c']} días")
    print(f"  Lluvias intensas (>=20mm): {events['heavy_rain']['days_above_20mm']} días ({events['heavy_rain']['percentage_heavy_rain_days']}%)")
    print(f"  Lluvias muy intensas (>=50mm): {events['heavy_rain']['days_above_50mm']} días")
    print(f"  Nieve (código WMO): {events['snow']['days_with_snow_code']} días")
    print(f"  Granizo (código WMO): {events['hail']['hours_with_hail_code']} horas")
    
    return {
        "location_key": location_key,
        "meta": meta,
        "csv_info": csv_info,
        "hourly_df": hourly_df,
        "daily_df": daily_df,
        "derived_df": derived_df,
        "feature_df": feature_df,
        "labels_df": labels_df,
        "quality_report": quality_report,
    }


def process_all_csvs():
    """Procesa los 3 CSV y guarda datos procesados e informes."""
    all_data = {}
    all_reports = {}
    
    for location_key in CSV_FILES:
        try:
            data = process_single_csv(location_key)
            all_data[location_key] = data
            all_reports[location_key] = data["quality_report"]
            
            # Guardar datos procesados
            feature_df = data["feature_df"]
            labels_df = data["labels_df"]
            
            # Combinar features y labels para guardado
            combined = feature_df.copy()
            for col in labels_df.columns:
                combined[f"label_{col}"] = labels_df[col].values
            
            output_path = PROCESSED_DIR / f"{location_key}_processed.csv"
            combined.to_csv(output_path, index=False)
            print(f"  ✅ Guardado: {output_path}")
            
        except Exception as e:
            print(f"  ❌ Error procesando {location_key}: {e}")
            import traceback
            traceback.print_exc()
    
    # Guardar informes de calidad
    report_path = REPORTS_DIR / "data_quality_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(all_reports, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n✅ Informe de calidad guardado: {report_path}")
    
    return all_data, all_reports


if __name__ == "__main__":
    print("=" * 60)
    print("AgroPasco — Procesamiento de Datos Meteorológicos")
    print("=" * 60)
    all_data, all_reports = process_all_csvs()
    print("\n✅ Procesamiento completado.")
