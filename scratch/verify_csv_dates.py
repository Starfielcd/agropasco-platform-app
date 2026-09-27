import pandas as pd
import glob

files = sorted(glob.glob('backend/data/weather-history/processed/*.csv'))
for f in files:
    df = pd.read_csv(f)
    df['time'] = pd.to_datetime(df['time'])
    min_date = df['time'].min()
    max_date = df['time'].max()
    n_rows = len(df)
    n_unique = df['time'].nunique()
    expected_range = pd.date_range(min_date, max_date, freq='D')
    missing_dates = expected_range.difference(df['time'])
    print(f"Archivo: {f}")
    print(f"  Total filas: {n_rows}")
    print(f"  Fechas unicas: {n_unique}")
    print(f"  Fecha min: {min_date.strftime('%Y-%m-%d')}")
    print(f"  Fecha max: {max_date.strftime('%Y-%m-%d')}")
    print(f"  Dias esperados en rango: {len(expected_range)}")
    print(f"  Fechas faltantes: {len(missing_dates)}")
    print(f"  Fechas duplicadas: {n_rows - n_unique}")
    print()
