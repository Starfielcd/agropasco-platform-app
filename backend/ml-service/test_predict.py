"""Quick test of ML prediction endpoint."""
import httpx
import json

# Test health
r = httpx.get("http://127.0.0.1:8100/health", timeout=10)
print("=== HEALTH ===")
print(json.dumps(r.json(), indent=2))

# Test models status
r = httpx.get("http://127.0.0.1:8100/models/status", timeout=10)
print("\n=== MODELS STATUS ===")
print(json.dumps(r.json(), indent=2))

# Test prediction for Cerro de Pasco coordinates
print("\n=== PREDICTION (Cerro de Pasco) ===")
try:
    r = httpx.post("http://127.0.0.1:8100/predict", json={
        "parcel_id": 1,
        "parcel_name": "Parcela Test Cerro de Pasco",
        "latitude": -10.6674,
        "longitude": -76.2567,
        "altitude_masl": 4380,
        "crop_type": "papa",
    }, timeout=30)
    print(f"Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        print(f"Parcel: {data.get('parcel_name')}")
        print(f"Issued: {data.get('issued_at')}")
        print(f"Source: {data.get('data_source')}")
        print(f"Coverage Warning: {data.get('coverage_warning')}")
        for pred in data.get("predictions", []):
            print(f"  {pred['phenomenon']}: risk={pred['risk_level']} score={pred['risk_score']} type={pred['model_type']}")
    else:
        print(f"Error: {r.text[:500]}")
except Exception as e:
    print(f"Exception: {e}")
