"""
AgroPasco ML — Exportador de Modelos a JSON y Generador de Casos Golden
=======================================================================
Fase 8C: Exporta GradientBoosting, RandomForest y LogisticRegression a
archivos JSON matemáticamente equivalentes sin modificar los .joblib originales.
Genera un conjunto golden de prueba con >= 200 vectores reales y extremos.
"""

import json
import math
import sys
from pathlib import Path
import joblib
import numpy as np
import pandas as pd

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MODELS_DIR = REPO_ROOT / "backend" / "data" / "weather-history" / "models"
OUTPUT_DIR = REPO_ROOT / "backend" / "data" / "models-json"
PROCESSED_DIR = REPO_ROOT / "backend" / "data" / "weather-history" / "processed"
FIXTURES_DIR = REPO_ROOT / "backend" / "tests" / "fixtures"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
FIXTURES_DIR.mkdir(parents=True, exist_ok=True)


def calculate_risk_level(prob):
    """Calcula nivel de riesgo y score acorde a los umbrales de AgroPasco."""
    if prob >= 0.70:
        level = "high"
    elif prob >= 0.40:
        level = "moderate"
    elif prob >= 0.15:
        level = "low"
    else:
        level = "none"
    score = round(prob * 100.0, 1)
    return level, score


def export_frost_model():
    """Exporta el modelo de heladas (LogisticRegression o GradientBoostingClassifier)."""
    model_path = MODELS_DIR / "frost" / "model.joblib"
    scaler_path = MODELS_DIR / "frost" / "scaler.joblib"
    meta_path = MODELS_DIR / "frost" / "metadata.json"
    
    if not model_path.exists():
        raise FileNotFoundError(f"No existe artefacto: {model_path}")
        
    model = joblib.load(model_path)
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
        
    features = meta.get("features", [])
    n_features = len(features)
    
    if hasattr(model, "coef_"):
        # LogisticRegression
        scaler = joblib.load(scaler_path) if scaler_path.exists() else None
        coefs = [float(c) for c in model.coef_[0]]
        intercept = float(model.intercept_[0])
        means = [float(m) for m in scaler.mean_] if scaler else [0.0] * n_features
        scales = [float(s) for s in scaler.scale_] if scaler else [1.0] * n_features
        
        exported = {
            "phenomenon": "frost",
            "model_type": "logistic_regression",
            "algorithm": "LogisticRegression",
            "version": meta.get("version", "2.0.0_audited_no_leak"),
            "trained_at": meta.get("trained_at", ""),
            "features": features,
            "n_features": n_features,
            "coefficients": coefs,
            "intercept": intercept,
            "scaler": {
                "mean": means,
                "scale": scales,
            },
            "risk_thresholds": {
                "high": 0.70,
                "moderate": 0.40,
                "low": 0.15,
            },
        }
    else:
        # GradientBoostingClassifier
        init_raw_val = float(model._raw_predict_init(np.zeros((1, n_features), dtype=np.float32))[0, 0])
        learning_rate = float(model.learning_rate)
        
        trees = []
        total_nodes = 0
        for stage_idx in range(model.n_estimators_):
            estimator = model.estimators_[stage_idx, 0]
            tree = estimator.tree_
            node_count = int(tree.node_count)
            total_nodes += node_count
            
            left = tree.children_left.tolist()
            right = tree.children_right.tolist()
            feat = tree.feature.tolist()
            thresh = [float(t) for t in tree.threshold]
            val = [float(tree.value[i, 0, 0]) for i in range(node_count)]
            
            trees.append({
                "left": left,
                "right": right,
                "feature": feat,
                "threshold": thresh,
                "value": val,
            })
            
        exported = {
            "phenomenon": "frost",
            "model_type": "gradient_boosting",
            "algorithm": "GradientBoostingClassifier",
            "version": meta.get("version", "2.0.0_audited_no_leak"),
            "trained_at": meta.get("trained_at", ""),
            "features": features,
            "n_features": n_features,
            "learning_rate": learning_rate,
            "init_raw_value": init_raw_val,
            "n_estimators": len(trees),
            "total_nodes": total_nodes,
            "risk_thresholds": {
                "high": 0.70,
                "moderate": 0.40,
                "low": 0.15,
            },
            "trees": trees,
        }
    
    out_file = OUTPUT_DIR / "frost_model.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(exported, f, separators=(',', ':'))
        
    size_kb = out_file.stat().st_size / 1024.0
    print(f"[OK] Heladas exportado: {out_file} ({size_kb:.1f} KB, algoritmo: {exported.get('algorithm')})")
    scaler = joblib.load(scaler_path) if scaler_path.exists() else None
    return model, scaler, features



def export_heavy_rain_model():
    """Exporta el modelo de lluvias intensas (RandomForestClassifier)."""
    model_path = MODELS_DIR / "heavy_rain" / "model.joblib"
    meta_path = MODELS_DIR / "heavy_rain" / "metadata.json"
    
    if not model_path.exists():
        raise FileNotFoundError(f"No existe artefacto: {model_path}")
        
    model = joblib.load(model_path)
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
        
    features = meta.get("features", [])
    n_features = len(features)
    
    trees = []
    total_nodes = 0
    for estimator in model.estimators_:
        tree = estimator.tree_
        node_count = int(tree.node_count)
        total_nodes += node_count
        
        left = tree.children_left.tolist()
        right = tree.children_right.tolist()
        feat = tree.feature.tolist()
        thresh = [float(t) for t in tree.threshold]
        
        # Precomputar probabilidad de clase positiva (clase 1) en cada nodo
        prob_class1 = []
        for i in range(node_count):
            counts = tree.value[i, 0, :]
            total = float(np.sum(counts))
            if total > 0:
                p1 = float(counts[1] / total)
            else:
                p1 = 0.0
            prob_class1.append(p1)
            
        trees.append({
            "left": left,
            "right": right,
            "feature": feat,
            "threshold": thresh,
            "prob_class_1": prob_class1
        })
        
    exported = {
        "phenomenon": "heavy_rain",
        "model_type": "random_forest",
        "algorithm": "RandomForestClassifier",
        "version": meta.get("version", "2.0.0_audited_no_leak"),
        "trained_at": meta.get("trained_at", ""),
        "features": features,
        "n_features": n_features,
        "n_estimators": len(trees),
        "total_nodes": total_nodes,
        "risk_thresholds": {
            "high": 0.70,
            "moderate": 0.40,
            "low": 0.15
        },
        "trees": trees
    }
    
    out_file = OUTPUT_DIR / "heavy_rain_model.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(exported, f, separators=(',', ':'))
        
    size_kb = out_file.stat().st_size / 1024.0
    print(f"[OK] Lluvias intensas exportado: {out_file} ({size_kb:.1f} KB, {len(trees)} arboles, {total_nodes} nodos)")
    return model, features


def export_snow_model():
    """Exporta el modelo de nevadas (LogisticRegression + StandardScaler)."""
    model_path = MODELS_DIR / "snow" / "model.joblib"
    scaler_path = MODELS_DIR / "snow" / "scaler.joblib"
    meta_path = MODELS_DIR / "snow" / "metadata.json"
    
    if not model_path.exists() or not scaler_path.exists():
        raise FileNotFoundError("Artefactos de nieve incompletos")
        
    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path)
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
        
    features = meta.get("features", [])
    n_features = len(features)
    
    coefs = [float(c) for c in model.coef_[0]]
    intercept = float(model.intercept_[0])
    means = [float(m) for m in scaler.mean_]
    scales = [float(s) for s in scaler.scale_]
    
    exported = {
        "phenomenon": "snow",
        "model_type": "logistic_regression",
        "algorithm": "LogisticRegression",
        "version": meta.get("version", "2.0.0_audited_no_leak"),
        "trained_at": meta.get("trained_at", ""),
        "features": features,
        "n_features": n_features,
        "coefficients": coefs,
        "intercept": intercept,
        "scaler": {
            "mean": means,
            "scale": scales
        },
        "risk_thresholds": {
            "high": 0.70,
            "moderate": 0.40,
            "low": 0.15
        }
    }
    
    out_file = OUTPUT_DIR / "snow_model.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(exported, f, indent=2)
        
    size_kb = out_file.stat().st_size / 1024.0
    print(f"[OK] Nevadas exportado: {out_file} ({size_kb:.2f} KB, 13 coeficientes + scaler)")
    return model, scaler, features


def generate_golden_dataset(frost_model, frost_scaler, frost_features,
                            hr_model, hr_features,
                            snow_model, snow_scaler, snow_features):
    """
    Genera un conjunto representativo de casos de prueba (> 200) combinando:
    1. Registros reales del periodo de test de las 3 zonas agroecológicas.
    2. Casos sintéticos extremos y en fronteras de decisión.
    Calcula las predicciones nativas con scikit-learn y las almacena.
    """
    print("\n[INFO] Generando conjunto golden de validacion...")
    test_cases = []
    case_id = 1
    
    # 1. Casos Reales del Dataset de Test (> 2025-06-30)
    for zone, filename in [
        ("Cerro de Pasco", "cerro_de_pasco_processed.csv"),
        ("Yanahuanca", "yanahuanca_processed.csv"),
        ("Oxapampa", "oxapampa_processed.csv"),
    ]:
        csv_path = PROCESSED_DIR / filename
        if not csv_path.exists():
            continue
            
        df = pd.read_csv(csv_path)
        # Seleccionar últimas 55 filas por zona
        sample_df = df.tail(55)
        
        all_required_cols = list(set(frost_features + hr_features + snow_features))
        
        for _, row in sample_df.iterrows():
            feat_dict = {}
            for col in all_required_cols:
                val = row.get(col, 0.0)
                feat_dict[col] = float(val) if pd.notna(val) else 0.0
                
            test_cases.append({
                "test_id": case_id,
                "source": f"historical_{zone.lower().replace(' ', '_')}",
                "description": f"Registro histórico real de {zone} ({row.get('time', 'N/A')})",
                "features": feat_dict
            })
            case_id += 1
            
    print(f"  Casos históricos reales cargados: {len(test_cases)}")
    
    # 2. Casos Extremos y Fronteras de Decisión Sintéticas (~80 casos)
    synthetic_scenarios = [
        # Heladas extremas bajo cero en puna alta
        {"desc": "Helada severa extrema (-12°C, 4400m)", "overrides": {
            "temperature_2m_mean": -6.0, "temperature_2m_max": 2.0, "temp_range": 14.0,
            "temp_min_lag1": -10.0, "temp_max_lag1": 3.0, "temp_min_rolling_3d": -8.5,
            "temp_min_rolling_7d": -7.0, "wind_speed_10m_max": 1.2, "humidity_min": 25.0,
            "humidity_mean": 45.0, "elevation": 4400.0, "month": 7, "day_of_year": 195,
            "is_winter": 1, "is_dry_season": 1, "soil_moisture_mean": 0.12, "precip_lag1": 0.0
        }},
        {"desc": "Helada moderada en Yanahuanca (-2°C, 3200m)", "overrides": {
            "temperature_2m_mean": 4.0, "temperature_2m_max": 14.0, "temp_range": 16.0,
            "temp_min_lag1": -1.5, "temp_max_lag1": 13.0, "temp_min_rolling_3d": -0.5,
            "temp_min_rolling_7d": 1.0, "wind_speed_10m_max": 2.5, "humidity_min": 30.0,
            "humidity_mean": 55.0, "elevation": 3200.0, "month": 6, "day_of_year": 170,
            "is_winter": 1, "is_dry_season": 1, "soil_moisture_mean": 0.20, "precip_lag1": 0.0
        }},
        {"desc": "Lluvia torrencial en Oxapampa (75mm/día, selva)", "overrides": {
            "temperature_2m_min": 17.5, "temperature_2m_max": 24.0, "temperature_2m_mean": 20.0,
            "wind_speed_10m_max": 18.0, "precip_lag1": 45.0, "precip_rolling_3d": 110.0,
            "precip_rolling_7d": 190.0, "temp_max_rolling_3d": 23.5, "humidity_mean": 96.0,
            "humidity_max": 99.0, "soil_moisture_mean": 0.48, "elevation": 1814.0,
            "month": 2, "day_of_year": 45, "is_dry_season": 0, "et0_fao_evapotranspiration": 2.1
        }},
        {"desc": "Nevada en Cerro de Pasco (-3°C con precipitación)", "overrides": {
            "temperature_2m_mean": -1.0, "temperature_2m_min": -4.0, "temperature_2m_max": 3.0,
            "wind_speed_10m_max": 12.0, "elevation": 4337.0, "month": 6, "day_of_year": 180,
            "is_winter": 1, "temp_min_lag1": -3.0, "precip_lag1": 8.0, "humidity_mean": 92.0,
            "humidity_max": 98.0, "precip_rolling_3d": 18.0
        }},
        {"desc": "Calor seco atípico (sin riesgo de ningún fenómeno)", "overrides": {
            "temperature_2m_min": 14.0, "temperature_2m_max": 28.0, "temperature_2m_mean": 21.0,
            "wind_speed_10m_max": 5.0, "temp_range": 14.0, "temp_min_lag1": 13.5, "temp_max_lag1": 27.0,
            "temp_min_rolling_3d": 14.0, "temp_min_rolling_7d": 13.5, "humidity_mean": 40.0,
            "humidity_min": 20.0, "humidity_max": 60.0, "soil_moisture_mean": 0.15,
            "elevation": 1500.0, "month": 10, "day_of_year": 285, "is_winter": 0, "is_dry_season": 0,
            "precip_lag1": 0.0, "precip_rolling_3d": 0.0, "precip_rolling_7d": 0.0, "temp_max_rolling_3d": 27.5
        }}
    ]
    
    # Generar variaciones paramétricas sistemáticas en fronteras
    for sc in synthetic_scenarios:
        for factor in [0.75, 0.9, 1.0, 1.1, 1.25]:
            base_dict = {col: 10.0 for col in all_required_cols}
            base_dict["elevation"] = 3500.0
            base_dict["month"] = 5
            base_dict["day_of_year"] = 140
            base_dict["is_winter"] = 0
            base_dict["is_dry_season"] = 1
            
            for k, v in sc["overrides"].items():
                if isinstance(v, (int, float)) and k not in ["month", "day_of_year", "is_winter", "is_dry_season"]:
                    base_dict[k] = round(float(v * factor), 4)
                else:
                    base_dict[k] = float(v)
                    
            test_cases.append({
                "test_id": case_id,
                "source": "synthetic_boundary",
                "description": f"{sc['desc']} (variación factor={factor})",
                "features": base_dict
            })
            case_id += 1
            
    # Añadir variaciones térmicas paso a paso entre -10°C y +15°C
    for t_min in [-10.0, -5.0, -2.0, -1.0, 0.0, 1.0, 2.0, 3.5, 5.0, 8.0]:
        t_dict = {col: 5.0 for col in all_required_cols}
        t_dict["temperature_2m_min"] = t_min
        t_dict["temperature_2m_mean"] = t_min + 4.0
        t_dict["temperature_2m_max"] = t_min + 12.0
        t_dict["temp_range"] = 12.0
        t_dict["temp_min_lag1"] = t_min - 0.5
        t_dict["temp_max_lag1"] = t_min + 11.5
        t_dict["temp_min_rolling_3d"] = t_min
        t_dict["temp_min_rolling_7d"] = t_min + 0.5
        t_dict["elevation"] = 4337.0
        t_dict["humidity_mean"] = 65.0
        t_dict["soil_moisture_mean"] = 0.25
        t_dict["month"] = 7
        t_dict["day_of_year"] = 200
        t_dict["is_winter"] = 1
        t_dict["is_dry_season"] = 1
        
        test_cases.append({
            "test_id": case_id,
            "source": "synthetic_temperature_sweep",
            "description": f"Barrido térmico con temp_min = {t_min}°C",
            "features": t_dict
        })
        case_id += 1
        
    # Añadir variaciones de lluvia paso a paso entre 0mm y 90mm
    for precip in [0.0, 2.0, 8.0, 15.0, 19.9, 20.0, 25.0, 45.0, 60.0, 90.0]:
        r_dict = {col: 10.0 for col in all_required_cols}
        r_dict["precipitation_sum"] = precip
        r_dict["precip_lag1"] = precip * 0.8
        r_dict["precip_rolling_3d"] = precip * 2.2
        r_dict["precip_rolling_7d"] = precip * 4.5
        r_dict["humidity_mean"] = min(99.0, 50.0 + precip * 0.5)
        r_dict["humidity_max"] = min(100.0, 65.0 + precip * 0.4)
        r_dict["soil_moisture_mean"] = min(0.55, 0.15 + precip * 0.005)
        r_dict["elevation"] = 2000.0
        r_dict["month"] = 2
        r_dict["day_of_year"] = 40
        r_dict["is_winter"] = 0
        r_dict["is_dry_season"] = 0
        
        test_cases.append({
            "test_id": case_id,
            "source": "synthetic_precip_sweep",
            "description": f"Barrido pluviométrico con precip = {precip}mm",
            "features": r_dict
        })
        case_id += 1

    print(f"  Total de vectores generados: {len(test_cases)}")
    
    # 3. Calcular predicciones de Python de referencia para cada caso
    golden_results = []
    
    for case in test_cases:
        feat = case["features"]
        
        # Frost
        X_frost = np.array([[feat[c] for c in frost_features]], dtype=np.float32)
        if frost_scaler is not None:
            X_frost_eval = frost_scaler.transform(X_frost)
        else:
            X_frost_eval = X_frost
        frost_prob = float(frost_model.predict_proba(X_frost_eval)[0, 1])
        frost_raw = float(frost_model.decision_function(X_frost_eval)[0])
        frost_level, frost_score = calculate_risk_level(frost_prob)
        
        # Heavy rain
        X_hr = np.array([[feat[c] for c in hr_features]], dtype=np.float32)
        hr_prob = float(hr_model.predict_proba(X_hr)[0, 1])
        hr_level, hr_score = calculate_risk_level(hr_prob)
        
        # Snow
        X_snow = np.array([[feat[c] for c in snow_features]], dtype=np.float64)
        X_snow_scaled = snow_scaler.transform(X_snow)
        snow_prob = float(snow_model.predict_proba(X_snow_scaled)[0, 1])
        snow_z = float(np.dot(X_snow_scaled, snow_model.coef_.T)[0, 0] + snow_model.intercept_[0])
        snow_level, snow_score = calculate_risk_level(snow_prob)
        
        golden_results.append({
            "test_id": case["test_id"],
            "source": case["source"],
            "description": case["description"],
            "features": feat,
            "expected": {
                "frost": {
                    "probability": frost_prob,
                    "raw_score": frost_raw,
                    "risk_level": frost_level,
                    "risk_score": frost_score
                },
                "heavy_rain": {
                    "probability": hr_prob,
                    "risk_level": hr_level,
                    "risk_score": hr_score
                },
                "snow": {
                    "probability": snow_prob,
                    "z_score": snow_z,
                    "risk_level": snow_level,
                    "risk_score": snow_score
                }
            }
        })
        
    fixtures_file = FIXTURES_DIR / "golden_ml_test_cases.json"
    with open(fixtures_file, "w", encoding="utf-8") as f:
        json.dump(golden_results, f, indent=2)
        
    size_kb = fixtures_file.stat().st_size / 1024.0
    print(f"[OK] Archivo golden guardado: {fixtures_file} ({len(golden_results)} casos, {size_kb:.1f} KB)")
    return golden_results


def main():
    print("=" * 60)
    print("AGROPASCO - FASE 8C: Exportacion de Modelos ML a JSON")
    print("=" * 60)
    
    frost_model, frost_scaler, frost_features = export_frost_model()
    hr_model, hr_features = export_heavy_rain_model()
    snow_model, snow_scaler, snow_features = export_snow_model()
    
    golden_cases = generate_golden_dataset(
        frost_model, frost_scaler, frost_features,
        hr_model, hr_features,
        snow_model, snow_scaler, snow_features
    )
    
    print("\n[SUCCESS] Exportacion y generacion golden completadas con exito.")


if __name__ == "__main__":
    main()
