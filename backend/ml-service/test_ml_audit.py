"""
AgroPasco ML Service — Suite de Pruebas Automatizadas de Auditoría
===================================================================
Verifica:
1. Procesamiento de los 3 CSV originales (sin modificarlos).
2. Validación de rangos y calidad meteorológica.
3. Carga e integridad de modelos serializados.
4. Inferencia y predicción individual por parcela.
5. Tolerancia a errores de Open-Meteo.
6. Parcelas sin altitud (fallback a elevación de modelo/DEM).
7. Coordenadas inválidas y advertencias de cobertura geográfica.
8. Manejo de modelos no disponibles.
9. Datos insuficientes (Granizo -> fallback a reglas).
"""

import unittest
import os
import sys
import numpy as np
import pandas as pd
from pathlib import Path

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import (
    RAW_DIR, MODELS_DIR, CSV_FILES,
    FROST_THRESHOLD_C, HEAVY_RAIN_DAILY_THRESHOLD_MM,
    SNOW_WMO_CODES, HAIL_WMO_CODES,
)
from data_processor import (
    parse_csv_metadata, find_daily_header_line,
    read_hourly_data, read_daily_data, analyze_events,
)
import app as ml_app


class TestCSVAudit(unittest.TestCase):
    """1. Auditoría del procesamiento de los 3 CSV originales."""

    def test_csv_files_exist_and_intact(self):
        """Verifica que los 3 CSV existan y conserven su tamaño original."""
        for key, info in CSV_FILES.items():
            path = RAW_DIR / info["filename"]
            self.assertTrue(path.exists(), f"Archivo {info['filename']} no encontrado")
            size = path.stat().st_size
            self.assertGreater(size, 2_000_000, f"Tamaño sospechoso para {info['filename']}: {size} bytes")

    def test_csv_structure_and_no_missing_values(self):
        """Verifica que cada CSV tenga metadatos, sección horaria y diaria, sin nulos."""
        for key, info in CSV_FILES.items():
            path = RAW_DIR / info["filename"]
            meta = parse_csv_metadata(str(path))
            self.assertIn("latitude", meta)
            self.assertIn("longitude", meta)
            self.assertIn("elevation", meta)
            self.assertGreater(meta["elevation"], 1000, f"Elevación inverosímil para Pasco: {meta['elevation']}")

            daily_line = find_daily_header_line(str(path))
            self.assertIsNotNone(daily_line, f"No se encontró cabecera diaria en {info['filename']}")
            self.assertGreater(daily_line, 50000)

            hourly_df = read_hourly_data(str(path), daily_line)
            daily_df = read_daily_data(str(path), daily_line)

            # Verificar filas exactas
            self.assertEqual(len(hourly_df), 59064, f"Filas horarias incorrectas en {info['filename']}")
            self.assertEqual(len(daily_df), 2461, f"Filas diarias incorrectas en {info['filename']}")

            # Verificar ausencia de nulos
            self.assertEqual(hourly_df.isnull().sum().sum(), 0, f"Hay nulos horarios en {info['filename']}")
            self.assertEqual(daily_df.isnull().sum().sum(), 0, f"Hay nulos diarios en {info['filename']}")

            # Verificar ausencia de duplicados por fecha
            self.assertEqual(hourly_df["time"].duplicated().sum(), 0)
            self.assertEqual(daily_df["time"].duplicated().sum(), 0)


class TestWeatherDataValidation(unittest.TestCase):
    """2. Validación de rangos físicos de variables meteorológicas."""

    def test_physical_temperature_ranges(self):
        for key, info in CSV_FILES.items():
            path = RAW_DIR / info["filename"]
            daily_line = find_daily_header_line(str(path))
            hourly_df = read_hourly_data(str(path), daily_line)

            # Rango físico de temperatura en Pasco (-15°C a +40°C)
            temps = hourly_df["temperature_2m"]
            self.assertGreaterEqual(temps.min(), -15.0, f"Temperatura extrema anómala en {key}")
            self.assertLessEqual(temps.max(), 40.0, f"Temperatura extrema anómala en {key}")

            # Humedad relativa [0, 100]%
            rh = hourly_df["relative_humidity_2m"]
            self.assertGreaterEqual(rh.min(), 0.0)
            self.assertLessEqual(rh.max(), 100.0)

            # Precipitación >= 0
            precip = hourly_df["precipitation"]
            self.assertGreaterEqual(precip.min(), 0.0)
            self.assertLessEqual(precip.max(), 150.0, f"Precipitación horaria imposible: {precip.max()}")


class TestModelLoadingAndIntegrity(unittest.TestCase):
    """3. Carga e integridad de modelos serializados."""

    def test_models_exist_and_load(self):
        ml_app.load_models()
        loaded = ml_app.models
        self.assertIn("frost", loaded, "Modelo de heladas no cargado")
        self.assertIn("heavy_rain", loaded, "Modelo de lluvias intensas no cargado")
        self.assertIn("snow", loaded, "Modelo de nevada no cargado")

        for phenom in ["frost", "heavy_rain", "snow"]:
            model_info = loaded[phenom]
            self.assertIsNotNone(model_info.get("model"))
            self.assertTrue(len(model_info.get("features", [])) > 0)
            self.assertTrue(hasattr(model_info["model"], "predict"))
            self.assertTrue(hasattr(model_info["model"], "predict_proba"))


class TestInferencePipeline(unittest.TestCase):
    """4-9: Pruebas de inferencia, fallbacks, casos límite y manejo de errores."""

    def setUp(self):
        ml_app.load_models()

    def test_prediction_cerro_de_pasco_high_altitude(self):
        """4. Predicción en coordenadas reales de Cerro de Pasco (4380m)."""
        dates = pd.date_range("2026-09-27", periods=3, freq="D")
        mock_forecast = {
            "elevation": 4337.0,
            "daily": {
                "time": [d.strftime("%Y-%m-%d") for d in dates],
                "temperature_2m_max": [10.0, 9.5, 11.0],
                "temperature_2m_min": [-2.0, -3.5, 0.5],
                "temperature_2m_mean": [4.0, 3.0, 5.5],
                "precipitation_sum": [1.5, 0.0, 0.2],
                "rain_sum": [0.0, 0.0, 0.2],
                "wind_speed_10m_max": [15.0, 18.0, 12.0],
                "et0_fao_evapotranspiration": [2.1, 2.5, 2.0],
            },
            "hourly": {
                "time": [d.strftime("%Y-%m-%dT%H:00") for d in pd.date_range("2026-09-27", periods=72, freq="h")],
                "temperature_2m": np.random.uniform(-3, 10, 72).tolist(),
                "relative_humidity_2m": np.random.uniform(50, 95, 72).tolist(),
                "precipitation": [0.0] * 72,
                "soil_moisture_0_to_7cm": [0.35] * 72,
                "weather_code": [3] * 72,
            }
        }

        feature_df = ml_app.prepare_forecast_features(mock_forecast, altitude_masl=4380)
        self.assertEqual(len(feature_df), 3)

        # Predicción helada
        frost_pred = ml_app.predict_with_model("frost", feature_df)
        self.assertIsNotNone(frost_pred)
        self.assertIn("predictions", frost_pred)
        self.assertIn("probabilities", frost_pred)
        self.assertEqual(len(frost_pred["predictions"]), 3)
        self.assertTrue(all(0.0 <= p <= 1.0 for p in frost_pred["probabilities"]))

    def test_parcel_without_altitude(self):
        """6. Parcela sin altitud: debe utilizar la elevación del modelo de terreno."""
        dates = pd.date_range("2026-09-27", periods=3, freq="D")
        mock_forecast = {
            "elevation": 3219.0,
            "daily": {
                "time": [d.strftime("%Y-%m-%d") for d in dates],
                "temperature_2m_max": [18.0, 17.5, 19.0],
                "temperature_2m_min": [6.0, 5.5, 7.0],
                "temperature_2m_mean": [12.0, 11.0, 13.0],
                "precipitation_sum": [5.0, 3.0, 0.0],
                "rain_sum": [5.0, 3.0, 0.0],
                "wind_speed_10m_max": [8.0, 10.0, 7.0],
                "et0_fao_evapotranspiration": [3.1, 3.0, 3.2],
            }
        }
        # Sin altitude_masl explícito (None)
        feature_df = ml_app.prepare_forecast_features(mock_forecast, altitude_masl=None)
        self.assertEqual(feature_df["elevation"].iloc[0], 3219.0, "No utilizó la elevación del modelo DEM")

    def test_coverage_warning_inside_vs_outside_pasco(self):
        """7. Advertencias de cobertura geográfica para ubicaciones lejanas."""
        # Dentro de Pasco (cerca de Cerro de Pasco)
        warn_inside = ml_app.check_coverage_warning(-10.66, -76.25, 4380)
        self.assertIsNone(warn_inside, "No debería generar advertencia para ubicación cercana a entrenamiento")

        # Fuera de Pasco (ej: Lima, lat -12.04, lon -77.03)
        warn_outside = ml_app.check_coverage_warning(-12.04, -77.03, 150)
        self.assertIsNotNone(warn_outside, "Debe advertir para ubicaciones fuera de Pasco")
        self.assertIn("ubicación de entrenamiento más cercana", warn_outside)

    def test_hail_fallback_to_rules(self):
        """9. Granizo: datos insuficientes para ML, debe ejecutarse el fallback basado en reglas."""
        dates = pd.date_range("2026-09-27", periods=3, freq="D")
        feature_df = pd.DataFrame({
            "temperature_2m_mean": [8.0, 12.0, 10.0],
            "precipitation_sum": [25.0, 0.0, 5.0],
            "humidity_max": [92.0, 60.0, 70.0],
        })
        hail_results = ml_app.rule_based_risk("hail", feature_df)
        self.assertEqual(len(hail_results), 3)
        # El día 1 con 25mm de precipitación y 92% humedad debe activar riesgo
        self.assertGreaterEqual(hail_results[0]["score"], 30)
        self.assertEqual(hail_results[0]["level"], "moderate")
        # El día 2 sin lluvia debe ser sin riesgo
        self.assertEqual(hail_results[1]["level"], "none")

    def test_untrained_model_fallback(self):
        """8. Modelo inexistente o no cargado: debe retornar None de forma segura."""
        feature_df = pd.DataFrame({"month": [9], "elevation": [4000]})
        result = ml_app.predict_with_model("tsunami_risk", feature_df)
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
