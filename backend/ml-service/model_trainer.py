"""
AgroPasco ML Service — Entrenamiento y Evaluación de Modelos (Auditado y Sin Fuga)
==================================================================================
Entrena modelos de clasificación para predicción de riesgos meteorológicos.
Utiliza validación temporal estricta (no aleatoria) para evitar filtración de información.

Modelos evaluados:
  - Baselines: Dummy Majority, Dummy Stratified, Regla Heurística Simple de Dominio
  - Machine Learning: Random Forest, Gradient Boosting, Regresión Logística

Métricas calculadas sobre conjunto de prueba independiente (> 2025-06-30):
  - Precision, Recall, F1-Score
  - PR-AUC, ROC-AUC
  - Matriz de confusión completa (TN, FP, FN, TP)
  - Brier Score y Expected Calibration Error (ECE)

Previene explícitamente Target Leakage:
  - Heladas: excluye temperature_2m_min, hours_below_0c, hours_below_3c.
  - Lluvias intensas: excluye precipitation_sum, rain_sum, max_hourly_precip, total_precip_hours.
  - Nevadas: excluye snow_code_hours.
  - Granizo: documentado formalmente como no viable para ML supervisado (0 eventos WMO 96-99).
"""

import json
import warnings
import numpy as np
import pandas as pd
import joblib
from datetime import datetime
from pathlib import Path

from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    precision_score, recall_score, f1_score,
    confusion_matrix, classification_report,
    average_precision_score, roc_auc_score,
    brier_score_loss,
)
from sklearn.calibration import calibration_curve

from config import (
    MODELS_DIR, REPORTS_DIR, PROCESSED_DIR,
    TRAIN_END_DATE, VAL_END_DATE, RANDOM_STATE,
    CSV_FILES,
)
from data_processor import process_all_csvs, temporal_split

warnings.filterwarnings("ignore", category=UserWarning)


# =====================================================================
# Definición de Variables Predictoras SIN Filtración de Objetivo (No-Leak)
# =====================================================================

FROST_FEATURES = [
    "temperature_2m_mean", "temperature_2m_max",
    "temp_range", "wind_speed_10m_max",
    "et0_fao_evapotranspiration", "elevation",
    "month", "day_of_year", "is_winter", "is_dry_season",
    "temp_min_lag1", "temp_max_lag1", "precip_lag1",
    "temp_min_rolling_3d", "temp_min_rolling_7d",
    "humidity_mean", "humidity_min",
    "soil_moisture_mean",
]

HEAVY_RAIN_FEATURES = [
    "temperature_2m_min", "temperature_2m_max", "temperature_2m_mean",
    "wind_speed_10m_max", "et0_fao_evapotranspiration", "elevation",
    "month", "day_of_year", "is_dry_season",
    "precip_rolling_3d", "precip_rolling_7d",
    "precip_lag1", "temp_max_rolling_3d",
    "humidity_mean", "humidity_max",
    "soil_moisture_mean",
]

SNOW_FEATURES = [
    "temperature_2m_mean", "temperature_2m_min", "temperature_2m_max",
    "wind_speed_10m_max", "elevation",
    "month", "day_of_year", "is_winter",
    "temp_min_lag1", "precip_lag1",
    "humidity_mean", "humidity_max",
    "precip_rolling_3d",
]


class SimpleRuleBaseline:
    """Regla heurística simple de dominio agronómico para comparación baseline."""
    def __init__(self, phenomenon):
        self.phenomenon = phenomenon

    def predict(self, X):
        if not isinstance(X, pd.DataFrame):
            X = pd.DataFrame(X)
        if self.phenomenon == "frost":
            if "temperature_2m_mean" in X.columns:
                pred = (X["temperature_2m_mean"] <= 3.5).astype(int)
            elif "temp_min_lag1" in X.columns:
                pred = (X["temp_min_lag1"] <= 0.0).astype(int)
            else:
                pred = np.zeros(len(X), dtype=int)
            return pred.values if hasattr(pred, "values") else pred
        elif self.phenomenon == "heavy_rain":
            if "precip_lag1" in X.columns and "humidity_mean" in X.columns:
                pred = ((X["precip_lag1"] >= 15.0) | (X["humidity_mean"] >= 88.0)).astype(int)
            else:
                pred = np.zeros(len(X), dtype=int)
            return pred.values if hasattr(pred, "values") else pred
        elif self.phenomenon == "snow":
            if "elevation" in X.columns and "temperature_2m_mean" in X.columns:
                pred = ((X["elevation"] >= 3800) & (X["temperature_2m_mean"] <= 3.0)).astype(int)
            else:
                pred = np.zeros(len(X), dtype=int)
            return pred.values if hasattr(pred, "values") else pred
        return np.zeros(len(X), dtype=int)

    def predict_proba(self, X):
        preds = self.predict(X)
        proba = np.column_stack([1.0 - preds, preds.astype(float)])
        return proba


def compute_calibration_metrics(y_true, y_proba, n_bins=10):
    """Calcula Brier Score y Expected Calibration Error (ECE)."""
    try:
        y_true_arr = np.array(y_true)
        y_proba_arr = np.array(y_proba)
        brier = float(brier_score_loss(y_true_arr, y_proba_arr))

        bins = np.linspace(0.0, 1.0, n_bins + 1)
        bin_indices = np.digitize(y_proba_arr, bins) - 1
        bin_indices = np.clip(bin_indices, 0, n_bins - 1)
        ece = 0.0
        n_total = len(y_true_arr)

        for b in range(n_bins):
            mask = (bin_indices == b)
            n_b = int(np.sum(mask))
            if n_b > 0:
                p_b = float(np.mean(y_proba_arr[mask]))
                y_b = float(np.mean(y_true_arr[mask]))
                ece += (n_b / n_total) * abs(p_b - y_b)

        return {
            "brier_score": round(brier, 4),
            "expected_calibration_error": round(float(ece), 4),
            "is_calibrated": bool(ece < 0.10),
            "calibration_assessment": "Bien calibrado (ECE < 0.10)" if ece < 0.10 else "Calibración moderada/baja (se recomienda tratar como puntaje ordinal)",
        }
    except Exception as e:
        return {"error": str(e)}


def get_available_features(df, requested_features):
    """Retorna solo las features que existen en el dataframe."""
    available = [f for f in requested_features if f in df.columns]
    missing = [f for f in requested_features if f not in df.columns]
    if missing:
        print(f"  ⚠️ Variables no disponibles (se omiten): {missing}")
    return available


def prepare_training_data(all_data, target_label, feature_list):
    """Combina datos de las 3 ubicaciones y divide cronológicamente."""
    train_X_list, train_y_list = [], []
    val_X_list, val_y_list = [], []
    test_X_list, test_y_list = [], []
    
    for loc_key, data in all_data.items():
        feature_df = data["feature_df"]
        labels_df = data["labels_df"]
        
        if target_label not in labels_df.columns:
            continue
        
        pos_count = labels_df[target_label].sum()
        if pos_count == 0:
            print(f"  ⚠️ {loc_key}: 0 eventos positivos para '{target_label}', omitiendo")
            continue
        
        available_features = get_available_features(feature_df, feature_list)
        if len(available_features) < 5:
            continue
        
        splits = temporal_split(feature_df, labels_df)
        
        for split_name, (X_list, y_list) in [
            ("train", (train_X_list, train_y_list)),
            ("val", (val_X_list, val_y_list)),
            ("test", (test_X_list, test_y_list)),
        ]:
            X = splits[split_name]["features"][available_features].copy()
            y = splits[split_name]["labels"][target_label].copy()
            
            valid_mask = X.notna().all(axis=1) & y.notna()
            X = X[valid_mask]
            y = y[valid_mask]
            
            X_list.append(X)
            y_list.append(y)
    
    if not train_X_list:
        return None, None, None, None, None, None, []
    
    train_X = pd.concat(train_X_list, ignore_index=True)
    train_y = pd.concat(train_y_list, ignore_index=True)
    val_X = pd.concat(val_X_list, ignore_index=True)
    val_y = pd.concat(val_y_list, ignore_index=True)
    test_X = pd.concat(test_X_list, ignore_index=True)
    test_y = pd.concat(test_y_list, ignore_index=True)
    
    used_features = list(train_X.columns)
    return train_X, train_y, val_X, val_y, test_X, test_y, used_features


def evaluate_model(model, X, y, split_name="test"):
    """Evalúa un modelo y retorna métricas detalladas."""
    if len(X) == 0 or len(y) == 0:
        return {"error": f"Conjunto {split_name} vacío"}
    
    y_pred = model.predict(X)
    
    metrics = {
        "split": split_name,
        "n_samples": int(len(y)),
        "n_positive": int(y.sum()),
        "n_negative": int((y == 0).sum()),
        "class_balance": round(float(y.mean()), 4),
    }
    
    if y.nunique() < 2:
        metrics["warning"] = f"Solo una clase presente en {split_name}."
        metrics["accuracy"] = float((y_pred == y).mean())
        return metrics
    
    metrics["precision"] = round(float(precision_score(y, y_pred, zero_division=0)), 4)
    metrics["recall"] = round(float(recall_score(y, y_pred, zero_division=0)), 4)
    metrics["f1"] = round(float(f1_score(y, y_pred, zero_division=0)), 4)
    
    cm = confusion_matrix(y, y_pred)
    metrics["confusion_matrix"] = cm.tolist()
    metrics["true_negatives"] = int(cm[0, 0]) if cm.shape[0] > 1 else int(cm[0, 0])
    metrics["false_positives"] = int(cm[0, 1]) if cm.shape[1] > 1 else 0
    metrics["false_negatives"] = int(cm[1, 0]) if cm.shape[0] > 1 else 0
    metrics["true_positives"] = int(cm[1, 1]) if cm.shape[0] > 1 and cm.shape[1] > 1 else 0
    
    # Probabilistic and calibration metrics
    if hasattr(model, "predict_proba"):
        try:
            y_proba = model.predict_proba(X)[:, 1]
            metrics["pr_auc"] = round(float(average_precision_score(y, y_proba)), 4)
            metrics["roc_auc"] = round(float(roc_auc_score(y, y_proba)), 4)
            cal_metrics = compute_calibration_metrics(y, y_proba)
            metrics.update(cal_metrics)
        except Exception as e:
            metrics["proba_error"] = str(e)
    
    return metrics


def train_phenomenon_model(all_data, phenomenon, target_label, feature_list):
    """
    Entrena y evalúa candidatos de ML y Baselines para un fenómeno dado.
    """
    print(f"\n{'='*60}")
    print(f"ENTRENAMIENTO AUDITADO: {phenomenon.upper()} (Sin Target Leakage)")
    print(f"Etiqueta: {target_label} (proxy basada en reglas ERA5)")
    print(f"{'='*60}")
    
    train_X, train_y, val_X, val_y, test_X, test_y, used_features = \
        prepare_training_data(all_data, target_label, feature_list)
    
    if train_X is None:
        print(f"  ❌ No hay datos suficientes para entrenar modelo de {phenomenon}")
        return None, {
            "phenomenon": phenomenon,
            "status": "no_data",
            "message": "No se encontraron datos suficientes para entrenar el modelo.",
        }
    
    print(f"  Datos de entrenamiento (<= {TRAIN_END_DATE}): {len(train_X):,} filas ({int(train_y.sum())} positivos)")
    print(f"  Datos de validación   ({TRAIN_END_DATE} a {VAL_END_DATE}): {len(val_X):,} filas ({int(val_y.sum())} positivos)")
    print(f"  Datos de test         (> {VAL_END_DATE}): {len(test_X):,} filas ({int(test_y.sum())} positivos)")
    print(f"  Variables de entrada (No-Leak): {len(used_features)}")
    
    # Escalar datos para modelos lineales
    scaler = StandardScaler()
    train_X_scaled = scaler.fit_transform(train_X)
    val_X_scaled = scaler.transform(val_X)
    test_X_scaled = scaler.transform(test_X)
    
    # 1. EVALUAR BASELINES EN TEST INDEPENDIENTE
    dummy_maj = DummyClassifier(strategy="most_frequent")
    dummy_maj.fit(train_X, train_y)
    dummy_maj_test = evaluate_model(dummy_maj, test_X, test_y, "test")

    dummy_strat = DummyClassifier(strategy="stratified", random_state=RANDOM_STATE)
    dummy_strat.fit(train_X, train_y)
    dummy_strat_test = evaluate_model(dummy_strat, test_X, test_y, "test")

    rule_base = SimpleRuleBaseline(phenomenon)
    rule_base_test = evaluate_model(rule_base, test_X, test_y, "test")

    baselines = {
        "dummy_most_frequent": dummy_maj_test,
        "dummy_stratified": dummy_strat_test,
        "simple_domain_rule": rule_base_test,
    }
    
    print(f"  Baselines (Test F1):")
    print(f"    - Dummy Mayoría:    F1 = {dummy_maj_test.get('f1', 0):.4f}")
    print(f"    - Dummy Estrat.:    F1 = {dummy_strat_test.get('f1', 0):.4f}")
    print(f"    - Regla Dominio:    F1 = {rule_base_test.get('f1', 0):.4f}")

    # 2. MODELOS CANDIDATOS ML
    candidates = {
        "random_forest": RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            min_samples_split=10,
            min_samples_leaf=5,
            class_weight="balanced",
            random_state=RANDOM_STATE,
            n_jobs=-1,
        ),
        "gradient_boosting": GradientBoostingClassifier(
            n_estimators=100,
            max_depth=5,
            learning_rate=0.1,
            min_samples_split=10,
            min_samples_leaf=5,
            random_state=RANDOM_STATE,
        ),
        "logistic_regression": LogisticRegression(
            class_weight="balanced",
            max_iter=1000,
            random_state=RANDOM_STATE,
        ),
    }
    
    results = {}
    best_model = None
    best_model_name = None
    best_f1_val = -1
    
    for model_name, model in candidates.items():
        try:
            if model_name == "logistic_regression":
                model.fit(train_X_scaled, train_y)
                val_metrics = evaluate_model(model, val_X_scaled, val_y, "validation")
                test_metrics = evaluate_model(model, test_X_scaled, test_y, "test")
            else:
                model.fit(train_X, train_y)
                val_metrics = evaluate_model(model, val_X, val_y, "validation")
                test_metrics = evaluate_model(model, test_X, test_y, "test")
            
            results[model_name] = {
                "validation": val_metrics,
                "test": test_metrics,
            }
            
            val_f1 = val_metrics.get("f1", 0)
            test_f1 = test_metrics.get("f1", 0)
            print(f"  {model_name}: Val F1 = {val_f1:.4f} | Test F1 = {test_f1:.4f} (Prec: {test_metrics.get('precision', 0):.4f}, Rec: {test_metrics.get('recall', 0):.4f}, PR-AUC: {test_metrics.get('pr_auc', 0):.4f})")
            
            if val_f1 > best_f1_val:
                best_f1_val = val_f1
                best_model = model
                best_model_name = model_name
        except Exception as e:
            print(f"    ❌ Error entrenando {model_name}: {e}")
            results[model_name] = {"error": str(e)}
    
    if best_model is None:
        return None, {
            "phenomenon": phenomenon,
            "status": "training_failed",
            "message": "Ningún modelo pudo entrenarse correctamente.",
            "results": results,
        }
    
    feature_importance = {}
    if hasattr(best_model, "feature_importances_"):
        importances = best_model.feature_importances_
        for feat, imp in sorted(zip(used_features, importances), key=lambda x: -x[1]):
            feature_importance[feat] = round(float(imp), 4)
    
    best_test_metrics = results[best_model_name]["test"]
    best_val_metrics = results[best_model_name]["validation"]
    
    report = {
        "phenomenon": phenomenon,
        "target_label": target_label,
        "label_type": "proxy_rule_based_era5",
        "status": "trained",
        "selected_model": best_model_name,
        "selection_reason": f"Mejor F1 en validación ({best_f1_val:.4f})",
        "features_used": used_features,
        "n_features": len(used_features),
        "data_summary": {
            "train_samples": len(train_X),
            "train_positive": int(train_y.sum()),
            "train_negative": int((train_y == 0).sum()),
            "val_samples": len(val_X),
            "val_positive": int(val_y.sum()),
            "test_samples": len(test_X),
            "test_positive": int(test_y.sum()),
            "test_negative": int((test_y == 0).sum()),
            "train_period": f"<= {TRAIN_END_DATE}",
            "val_period": f"{TRAIN_END_DATE} a {VAL_END_DATE}",
            "test_period": f"> {VAL_END_DATE}",
        },
        "baselines": baselines,
        "model_comparison": results,
        "best_model_test_metrics": best_test_metrics,
        "feature_importance": feature_importance,
        "trained_at": datetime.now().isoformat(),
        "limitations": [
            "Etiquetas sintéticas derivadas de umbrales en datos de reanálisis ERA5 de Open-Meteo.",
            "No reemplaza validación empírica con estaciones de campo de SENAMHI.",
            "Representatividad geográfica centrada en Cerro de Pasco, Yanahuanca y Oxapampa.",
            "Las probabilidades son puntajes de riesgo del ensamble y no probabilidades calibradas estrictas.",
        ],
    }
    
    print(f"\n  🏆 Modelo Seleccionado: {best_model_name}")
    print(f"     Test F1: {best_test_metrics.get('f1', 0):.4f} | Prec: {best_test_metrics.get('precision', 0):.4f} | Rec: {best_test_metrics.get('recall', 0):.4f} | PR-AUC: {best_test_metrics.get('pr_auc', 0):.4f}")
    print(f"     Matriz Confusión (TN, FP, FN, TP): {best_test_metrics.get('confusion_matrix')}")
    print(f"     Brier Score: {best_test_metrics.get('brier_score')} | ECE: {best_test_metrics.get('expected_calibration_error')}")
    
    return {
        "model": best_model,
        "scaler": scaler if best_model_name == "logistic_regression" else None,
        "model_name": best_model_name,
        "features": used_features,
    }, report


def save_model(model_bundle, report, phenomenon):
    """Guarda el modelo entrenado y sus metadatos con métricas auditadas."""
    if model_bundle is None:
        print(f"  ⚠️ No hay modelo para guardar ({phenomenon})")
        return
    
    model_dir = MODELS_DIR / phenomenon
    model_dir.mkdir(parents=True, exist_ok=True)
    
    model_path = model_dir / "model.joblib"
    joblib.dump(model_bundle["model"], model_path)
    
    if model_bundle.get("scaler") is not None:
        scaler_path = model_dir / "scaler.joblib"
        joblib.dump(model_bundle["scaler"], scaler_path)
    
    best_name = model_bundle["model_name"]
    meta = {
        "phenomenon": phenomenon,
        "model_type": best_name,
        "features": model_bundle["features"],
        "requires_scaler": model_bundle.get("scaler") is not None,
        "version": "2.0.0_audited_no_leak",
        "trained_at": report["trained_at"],
        "status": report["status"],
        "label_type": report["label_type"],
        "validation_metrics": report["model_comparison"].get(best_name, {}).get("validation", {}),
        "test_metrics": report["best_model_test_metrics"],
        "baselines": report.get("baselines", {}),
        "calibration": {
            "brier_score": report["best_model_test_metrics"].get("brier_score"),
            "expected_calibration_error": report["best_model_test_metrics"].get("expected_calibration_error"),
            "is_calibrated": report["best_model_test_metrics"].get("is_calibrated"),
            "calibration_assessment": report["best_model_test_metrics"].get("calibration_assessment"),
        },
        "limitations": report.get("limitations", []),
    }
    
    meta_path = model_dir / "metadata.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    
    print(f"  ✅ Serializado: {model_path}")
    print(f"  ✅ Metadatos guardados: {meta_path}")


def train_all_models():
    """Ejecuta el pipeline completo de entrenamiento limpio sin fuga."""
    print("\n" + "=" * 60)
    print("AgroPasco — Pipeline de Entrenamiento ML Auditado y Sin Fuga")
    print("=" * 60)
    
    all_data, all_reports = process_all_csvs()
    training_results = {}
    
    # 1. Heladas (FROST)
    frost_bundle, frost_report = train_phenomenon_model(
        all_data, "frost", "frost", FROST_FEATURES
    )
    save_model(frost_bundle, frost_report, "frost")
    training_results["frost"] = frost_report
    
    # 2. Lluvias Intensas (HEAVY RAIN)
    rain_bundle, rain_report = train_phenomenon_model(
        all_data, "heavy_rain", "heavy_rain", HEAVY_RAIN_FEATURES
    )
    save_model(rain_bundle, rain_report, "heavy_rain")
    training_results["heavy_rain"] = rain_report
    
    # 3. Nieve (SNOW)
    snow_bundle, snow_report = train_phenomenon_model(
        all_data, "snow", "snow", SNOW_FEATURES
    )
    save_model(snow_bundle, snow_report, "snow")
    training_results["snow"] = snow_report
    
    # 4. Granizo (HAIL) — Heurística Determinista Documentada
    training_results["hail"] = {
        "phenomenon": "hail",
        "status": "not_viable_supervised_ml",
        "message": "El granizo en los Andes centrales es un evento convectivo de microescala no capturado por los códigos WMO globales del reanálisis ERA5 (0 horas registradas en 2020-2026). No es metodológicamente viable entrenar un modelo supervisado. Opera bajo reglas físicas heurísticas documentadas (temperatura > 5°C, humedad relativa > 85%, precipitación convectiva > 10mm).",
        "recommendation": "Incorporar registros de observaciones físicas de campo mediante la nueva tabla ground_truth_observations para futuro entrenamiento.",
    }
    print(f"\n  ⚠️ GRANIZO: No viable para ML supervisado (0 eventos WMO 96-99). Sistema de reglas físicas documentado.")
    
    # Guardar informe consolidado
    report_path = REPORTS_DIR / "training_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(training_results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n✅ Informe consolidado de entrenamiento: {report_path}")
    
    return training_results


if __name__ == "__main__":
    results = train_all_models()
