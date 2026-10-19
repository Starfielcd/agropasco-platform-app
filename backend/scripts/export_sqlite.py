#!/usr/bin/env python3
"""
AgroPasco — Exportador de SQLite a JSON / CSV
=============================================
Exporta de forma segura todas las tablas de una base SQLite a un archivo JSON
estructurado o archivos CSV para su posterior importación en PostgreSQL.

Uso:
  python backend/scripts/export_sqlite.py [--db RUTA_SQLITE] [--out RUTA_SALIDA_JSON] [--csv]
Ejemplo:
  python backend/scripts/export_sqlite.py --db backend/agropasco.db --out backend/data/export_data.json
"""

import sys
import os
import json
import sqlite3
import argparse
from datetime import datetime, timezone

# Garantizar compatibilidad con consola de Windows (evitar UnicodeEncodeError por emojis)
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

def export_sqlite(db_path, output_json, export_csv=False, csv_dir=None):
    if not os.path.exists(db_path):
        print(f"❌ Error: El archivo SQLite no existe en: {db_path}", file=sys.stderr)
        sys.exit(1)

    print(f"📂 Conectando a SQLite: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Obtener todas las tablas excepto sqlite_sequence o tablas internas
    cursor.execute("""
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name;
    """)
    tables = [row['name'] for row in cursor.fetchall()]

    if not tables:
        print("⚠️ No se encontraron tablas de usuario en la base de datos.")
        return

    print(f"📋 Tablas encontradas ({len(tables)}): {', '.join(tables)}")

    export_payload = {
        "_metadata": {
            "source_db": os.path.abspath(db_path),
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "table_count": len(tables)
        },
        "counts": {},
        "tables": {}
    }

    if export_csv and csv_dir:
        os.makedirs(csv_dir, exist_ok=True)

    print("\n" + "=" * 60)
    print(f"{'Tabla':<30} | {'Registros':<12} | {'Estado':<10}")
    print("=" * 60)

    for table in tables:
        try:
            cursor.execute(f"SELECT * FROM \"{table}\"")
            rows = cursor.fetchall()
            row_dicts = [dict(row) for row in rows]
            
            export_payload["tables"][table] = row_dicts
            export_payload["counts"][table] = len(row_dicts)

            print(f"{table:<30} | {len(row_dicts):<12} | ✅ OK")

            if export_csv and csv_dir:
                import csv
                csv_path = os.path.join(csv_dir, f"{table}.csv")
                if row_dicts:
                    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                        writer = csv.DictWriter(f, fieldnames=row_dicts[0].keys())
                        writer.writeheader()
                        writer.writerows(row_dicts)
                else:
                    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                        pass
        except Exception as e:
            print(f"{table:<30} | {'ERROR':<12} | ❌ {str(e)}")

    print("=" * 60)

    # Guardar archivo JSON
    os.makedirs(os.path.dirname(os.path.abspath(output_json)), exist_ok=True)
    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(export_payload, f, ensure_ascii=False, indent=2)

    file_size_kb = os.path.getsize(output_json) / 1024
    print(f"\n🎉 Exportación exitosa:")
    print(f"   Archivo JSON: {output_json} ({file_size_kb:.1f} KB)")
    if export_csv and csv_dir:
        print(f"   Archivos CSV en: {csv_dir}")
    print("=" * 60 + "\n")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Exportar base SQLite AgroPasco a JSON/CSV")
    parser.add_argument("--db", default=os.path.join("backend", "agropasco.db"), help="Ruta al archivo SQLite")
    parser.add_argument("--out", default=os.path.join("backend", "data", "export_data.json"), help="Ruta al JSON de salida")
    parser.add_argument("--csv", action="store_true", help="También exportar a archivos CSV individuales")
    parser.add_argument("--csv-dir", default=os.path.join("backend", "data", "csv_backup"), help="Directorio para CSVs")
    args = parser.parse_args()

    export_sqlite(args.db, args.out, export_csv=args.csv, csv_dir=args.csv_dir)
