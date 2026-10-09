#!/usr/bin/env python3
"""
WAYMARK | pipeline/load_crashes.py

Loads the real crash locations from the US Accidents CSV into the `crashes` table of waymark.db,
so the map can show each crash as a point inside its hexagon.

Every row comes from the CSV. A crash is kept only if its H3 cell exists in the `cells` table
(same resolution as the cells), so every point sits inside a hexagon the map draws.

Usage (from the project root, after pipeline/load_db.py):
    python pipeline/load_crashes.py --csv US_Accidents_March23.csv
    python pipeline/load_crashes.py --csv US_Accidents_March23.csv --state TX --city Houston --db waymark.db
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

import h3
import pandas as pd

COLS = ["ID", "Severity", "Start_Time", "Start_Lat", "Start_Lng", "City", "County", "Zipcode", "Street",
    "State", "Weather_Condition", "Sunrise_Sunset"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", required=True, help="US_Accidents_March23.csv")
    ap.add_argument("--db", default="waymark.db")
    ap.add_argument("--state", default="TX")
    ap.add_argument("--city", default="Houston")
    ap.add_argument("--chunk", type=int, default=500_000, help="rows read per chunk (keeps memory low)")
    a = ap.parse_args()

    if not Path(a.csv).exists():
        print(f"CSV not found: {a.csv}", file=sys.stderr)
        return 1
    if not Path(a.db).exists():
        print(f"Database not found: {a.db}. Run pipeline/load_db.py first.", file=sys.stderr)
        return 1

    con = sqlite3.connect(a.db)
    cell_ids = {r[0] for r in con.execute("SELECT cell_id FROM cells")}
    if not cell_ids:
        print("The cells table is empty. Run pipeline/load_db.py first.", file=sys.stderr)
        return 1
    res = h3.get_resolution(next(iter(cell_ids)))
    print(f"{len(cell_ids):,} cells in the database (H3 resolution {res}).")

    parts: list[pd.DataFrame] = []
    seen = 0
    for chunk in pd.read_csv(a.csv, usecols=lambda c: c in COLS, chunksize=a.chunk):
        seen += len(chunk)
        chunk = chunk[(chunk["State"] == a.state) & (chunk["City"] == a.city)]
        chunk = chunk.dropna(subset=["ID", "Start_Lat", "Start_Lng", "Start_Time"])
        if not chunk.empty:
            parts.append(chunk)
        print(f"  read {seen:,} rows...", end="\r")
    print()
    if not parts:
        print(f"No rows for {a.city}, {a.state}.", file=sys.stderr)
        return 1

    df = pd.concat(parts, ignore_index=True).drop_duplicates(subset="ID")
    df["Start_Time"] = pd.to_datetime(df["Start_Time"], format="mixed", errors="coerce")
    df = df.dropna(subset=["Start_Time"])
    n_city = len(df)

    df["cell_id"] = [h3.latlng_to_cell(la, ln, res) for la, ln in zip(df["Start_Lat"], df["Start_Lng"])]
    df = df[df["cell_id"].isin(cell_ids)]

    out = pd.DataFrame({
        "crash_id": df["ID"].astype(str),
        "cell_id": df["cell_id"],
        "lat": df["Start_Lat"].astype(float),
        "lng": df["Start_Lng"].astype(float),
        "start_time": df["Start_Time"].dt.strftime("%Y-%m-%d %H:%M"),
        "year": df["Start_Time"].dt.year.astype(int),
        "severity": pd.to_numeric(df["Severity"], errors="coerce").astype("Int64"),
        "weather": df["Weather_Condition"].fillna(""),
        "night": (df["Sunrise_Sunset"] == "Night").astype(int),
        "city": df["City"].fillna("").astype(str),
        "county": df["County"].fillna("").astype(str),
        "zipcode": df["Zipcode"].fillna("").astype(str),
        "street": df["Street"].fillna("").astype(str),
    })

    con.execute("DROP TABLE IF EXISTS crashes")
    con.execute("""CREATE TABLE crashes (
        crash_id TEXT PRIMARY KEY, cell_id TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
        start_time TEXT, year INTEGER, severity INTEGER, weather TEXT, night INTEGER,
        city TEXT, county TEXT, zipcode TEXT, street TEXT)""")
    out.to_sql("crashes", con, if_exists="append", index=False, chunksize=50_000)
    con.execute("CREATE INDEX ix_crashes_lat_lng ON crashes(lat, lng)")
    con.execute("CREATE INDEX ix_crashes_cell ON crashes(cell_id)")
    for column in ("city", "county", "zipcode", "street"):
        con.execute(f"CREATE INDEX ix_crashes_{column}_nocase ON crashes({column} COLLATE NOCASE)")
    con.commit()
    con.close()

    print(f"{a.city}, {a.state}: {n_city:,} crashes in the CSV; {len(out):,} fall inside a scored cell and were loaded.")
    print(f"{n_city - len(out):,} were outside every scored cell and were skipped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
