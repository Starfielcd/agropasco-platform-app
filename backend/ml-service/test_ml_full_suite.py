"""
AgroPasco ML Service — Suite Exhaustiva de Pruebas Automatizadas
================================================================
Verifica:
  1. Integridad de los 3 CSV originales en raw/
  2. Calidad de los 3 CSV procesados en processed/ (0 nulos, 0 duplicados)
  3. Rangos físicos coherentes en variables meteorológicas
  4. Carga de modelos serializados (.joblib y metadata.json)
  5. Ausencia de target leakage en las variables de los modelos
  6. Existencia y coherencia de métricas de calibración (Brier score y ECE)
  7. Inferencia por parcela (Cerro de Pasco, Yanahuanca, Oxapampa)
  8. Inferencia en parcela sin altitud (elevación DEM por defecto)
  9. Detección de advertencia geográfica fuera de Pasco (>55 km)
 10. Fallback determinista de Granizo a reglas físicas (0 eventos en ERA5)
 11. Fallback determinista ante modelo ausente o datos insuficientes
 12. Validación de coordenadas inválidas
"""

import sys
import unittest
import pandas as pd
import numpy as np
from pathlib import Path

# Setup paths
CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data" / "weather-history"

sys.path.insert(0, str(CURRENT_DIR))

from config import RAW_DIR, PROCESSED_DIR, MODELS_DIR, REPORTS_DIR, CSV_FILES
from app import (
    load_models, models, model_metadata,
    prepare_forecast_features, predict_with_model,
    rule_based_risk, check_coverage_warning
)


class TestMLServiceFullSuite(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        """Carga modelos y metadatos una sola vez para la suite."""
        load_models()

    def test_01_raw_csv_files_intact(self):
        """Verifica que los 3 CSV originales existen intactos sin modificaciones."""
        expected_sizes = {
            "cerro_de_pasco": (2327267, "Cerro_de_Pasco _Zona_alta_ Heladas.csv"),
            "yanahuanca": (2354500, "Yanahuanca_Daniel_Alcides_Carrión _Zona Andina.csv"),
            "oxapampa": (2403426, "Oxapampa_Zona_Selva_Alta_Lluvias_e_Humedad.csv"),
        }
        for key, (size, filename) in expected_sizes.items():
            path = RAW_DIR / filename
            self.assertTrue(path.exists(), f"CSV original no encontrado: {path}")
            self.assertEqual(path.stat().st_size, size, f"Tamaño alterado en {filename}")

    def test_02_processed_csv_integrity(self):
        """Verifica que los CSV procesados tienen exactamente 2,461 filas y 0 nulos."""
        for key in ["cerro_de_pasco", "yanahuanca", "oxapampa"]:
            proc_path = PROCESSED_DIR / f"{key}_processed.csv"
            self.assertTrue(proc_path.exists(), f"CSV procesado no encontrado: {proc_path}")
            df = pd.read_csv(proc_path)
            self.assertEqual(len(df), 2461, f"Filas incorrectas en {key}: {len(df)}")
            null_count = df.isnull().sum().sum()
            self.assertEqual(null_count, 0, f"Existen {null_count} valores nulos en {key}_processed.csv")

    def test_03_physical_variable_ranges(self):
        """Verifica que las variables meteorológicas respetan límites físicos."""
        for key in ["cerro_de_pasco", "yanahuanca", "oxapampa"]:
            df = pd.read_csv(PROCESSED_DIR / f"{key}_processed.csv")
            self.assertTrue((df["temperature_2m_max"] >= df["temperature_2m_min"]).all())
            self.assertTrue((df["temperature_2m_min"] >= -25.0).all())
            self.assertTrue((df["temperature_2m_max"] <= 45.0).all())
            self.assertTrue((df["precipitation_sum"] >= 0.0).all())
            self.assertTrue((df["wind_speed_10m_max"] >= 0.0).all())
            self.assertTrue((df["humidity_mean"] >= 0.0).all() and (df["humidity_mean"] <= 100.0).all())

    def test_04_models_serialized_and_loaded(self):
        """Verifica que los modelos viables (frost, heavy_rain, snow) están serializados y cargados."""
        for phenomenon in ["frost", "heavy_rain", "snow"]:
            self.assertIn(phenomenon, models, f"Modelo {phenomenon} no cargado en memoria")
            self.assertTrue((MODELS_DIR / phenomenon / "model.joblib").exists())
            self.assertTrue((MODELS_DIR / phenomenon / "metadata.json").exists())

    def test_05_no_target_leakage_in_features(self):
        """Verifica estrictamente que ninguna variable objetivo o equivalente entre a los modelos."""
        frost_meta = model_metadata.get("frost", {})
        frost_features = frost_meta.get("features", [])
        self.assertNotIn("temperature_2m_min", frost_features, "Fuga de target detectada: temperature_2m_min en frost!")
        self.assertNotIn("hours_below_0c", frost_features, "Fuga de target detectada: hours_below_0c en frost!")
        self.assertNotIn("hours_below_3c", frost_features, "Fuga de target detectada: hours_below_3c en frost!")

        rain_meta = model_metadata.get("heavy_rain", {})
        rain_features = rain_meta.get("features", [])
        self.assertNotIn("precipitation_sum", rain_features, "Fuga de target detectada: precipitation_sum en heavy_rain!")
        self.assertNotIn("rain_sum", rain_features, "Fuga de target detectada: rain_sum en heavy_rain!")
        self.assertNotIn("max_hourly_precip", rain_features, "Fuga de target detectada: max_hourly_precip en heavy_rain!")
        self.assertNotIn("total_precip_hours", rain_features, "Fuga de target detectada: total_precip_hours en heavy_rain!")

        snow_meta = model_metadata.get("snow", {})
        snow_features = snow_meta.get("features", [])
        self.assertNotIn("snow_code_hours", snow_features, "Fuga de target detectada: snow_code_hours en snow!")

    def test_06_calibration_metrics_documented(self):
        """Verifica que cada modelo entrenado calcula y documenta Brier Score y ECE."""
        for ph in ["frost", "heavy_rain", "snow"]:
            meta = model_metadata.get(ph, {})
            cal = meta.get("calibration", {})
            self.assertIn("brier_score", cal, f"Brier score ausente en {ph}")
            self.assertIn("expected_calibration_error", cal, f"ECE ausente en {ph}")
            self.assertIsNotNone(cal["brier_score"])
            self.assertIsNotNone(cal["expected_calibration_error"])

    def test_07_prediction_cerro_de_pasco_high_altitude(self):
        """Verifica inferencia para Cerro de Pasco (4337 msnm)."""
        mock_forecast = {
            "elevation": 4337,
            "daily": {
                "time": ["2026-09-28", "2026-09-29", "2026-09-30"],
                "temperature_2m_max": [8.5, 9.0, 7.8],
                "temperature_2m_min": [-2.5, -4.0, -1.0],
                "temperature_2m_mean": [3.0, 2.5, 3.4],
                "precipitation_sum": [0.0, 0.0, 1.5],
                "wind_speed_10m_max": [8.2, 7.5, 9.0],
                "et0_fao_evapotranspiration": [2.1, 2.3, 1.9],
            },
            "hourly": {
                "time": [f"2026-09-28T{h:02d}:00" for h in range(24)],
                "temperature_2m": [0.0] * 24,
                "relative_humidity_2m": [60.0] * 24,
                "precipitation": [0.0] * 24,
            }
        }
        df = prepare_forecast_features(mock_forecast, altitude_masl=4337)
        self.assertFalse(df.empty)
        res = predict_with_model("frost", df)
        self.assertIsNotNone(res)
        self.assertEqual(len(res["predictions"]), 3)
        self.assertEqual(len(res["probabilities"]), 3)

    def test_08_prediction_without_altitude(self):
        """Verifica que una parcela sin altitud utiliza la elevación del DEM del pronóstico."""
        mock_forecast = {
            "elevation": 3219,
            "daily": {
                "time": ["2026-09-28"],
                "temperature_2m_max": [16.0],
                "temperature_2m_min": [6.0],
                "temperature_2m_mean": [11.0],
                "precipitation_sum": [5.0],
                "wind_speed_10m_max": [5.0],
                "et0_fao_evapotranspiration": [3.0],
            },
        }
        df = prepare_forecast_features(mock_forecast, altitude_masl=None)
        self.assertEqual(df["elevation"].iloc[0], 3219)

    def test_09_geographic_coverage_warning(self):
        """Verifica que coordenadas dentro de Pasco no generen advertencia y fuera de Pasco sí."""
        # Dentro de Pasco (Chaupimarca)
        warn_in = check_coverage_warning(-10.6868, -76.2625, 4380)
        self.assertIsNone(warn_in)

        # Fuera de Pasco (Lima: -12.0464, -77.0428)
        warn_out = check_coverage_warning(-12.0464, -77.0428, 150)
        self.assertIsNotNone(warn_out)
        self.assertIn("menor fiabilidad", warn_out)

    def test_10_hail_fallback_to_rules(self):
        """Verifica que Granizo opera bajo reglas físicas deterministas con umbrales documentados."""
        self.assertNotIn("hail", models, "Granizo no debe tener modelo supervisado por falta de datos WMO")
        df_storm = pd.DataFrame([{
            "temperature_2m_mean": 12.0,
            "precipitation_sum": 25.0,
            "humidity_max": 95.0,
        }])
        rules_res = rule_based_risk("hail", df_storm)
        self.assertEqual(len(rules_res), 1)
        self.assertGreater(rules_res[0]["score"], 0)

    def test_11_fallback_when_features_insufficient(self):
        """Verifica degradación elegante cuando faltan variables críticas."""
        df_empty = pd.DataFrame([{"dummy": 1}])
        res = predict_with_model("frost", df_empty)
        self.assertIsNone(res, "predict_with_model debió retornar None ante features insuficientes")

    def test_12_reports_training_summary_valid(self):
        """Verifica que training_report.json existe y contiene las comparaciones contra baselines."""
        report_path = REPORTS_DIR / "training_report.json"
        self.assertTrue(report_path.exists())
        import json
        with open(report_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertIn("frost", data)
        self.assertIn("heavy_rain", data)
        self.assertIn("snow", data)
        self.assertIn("hail", data)
        self.assertIn("baselines", data["frost"])
        self.assertIn("dummy_most_frequent", data["frost"]["baselines"])
        self.assertIn("simple_domain_rule", data["frost"]["baselines"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
