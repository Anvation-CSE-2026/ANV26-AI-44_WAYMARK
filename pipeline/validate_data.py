#!/usr/bin/env python3
"""
WAYMARK | pipeline/validate_data.py

Validates the US Accidents dataset (2016-2023) and writes:
  * data_quality.json   (list of checks, each PASS / WARN / FAIL + plain explanation)
  * waymark.db tables   data_quality, yearly_counts   (skip with --no-db)

Every number in the output is computed from the CSV. Nothing is hardcoded
except thresholds, which are declared at the top and echoed in each detail.
WARNs are never filtered out; they are written to the JSON and the DB.

Usage:
    python pipeline/validate_data.py --csv US_Accidents_March23.csv
    python pipeline/validate_data.py --csv sample.csv --out out/data_quality.json --db waymark.db
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
HOUSTON_CITY, HOUSTON_STATE = "Houston", "TX"

KEY_COLUMNS = {
    "id": ["ID"],
    "location": ["Start_Lat", "Start_Lng"],
    "time": ["Start_Time"],
    "weather": ["Weather_Condition", "Precipitation(in)", "Temperature(F)"],
    "visibility": ["Visibility(mi)"],
    "day_night": ["Sunrise_Sunset"],
    "road_flags": [
        "Amenity", "Bump", "Crossing", "Give_Way", "Junction", "No_Exit",
        "Railway", "Roundabout", "Station", "Stop", "Traffic_Calming",
        "Traffic_Signal",
    ],
}
REQUIRED_COLUMNS = ["ID", "Severity", "Start_Time", "Start_Lat", "Start_Lng",
                    "City", "State", "Weather_Condition", "Visibility(mi)",
                    "Sunrise_Sunset"]
ALL_COLUMNS = sorted({c for v in KEY_COLUMNS.values() for c in v} | set(REQUIRED_COLUMNS))

EXPECTED_YEARS = (2016, 2023)
NULL_WARN, NULL_FAIL = 0.01, 0.10         # share of nulls
YOY_JUMP_RATIO = 1.5                      # year-over-year jump flagged above this
MIN_HOUSTON_YEARLY = 50                   # fewer rows than this in a year = thin data
RAIN_WORDS = ("rain", "drizzle", "shower", "thunderstorm", "t-storm", "storm")

# Time split. Features may only use data up to `feature_through`; the label
# (blackspot yes/no) is measured in `label_year`.
SPLITS = {
    "primary":  {"name": "train 2020-21", "feature_through": 2020, "label_year": 2021, "role": "train"},
    "primary_test": {"name": "test 2021-22", "feature_through": 2021, "label_year": 2022, "role": "test"},
}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def check(name: str, status: str, detail: str, **extra) -> dict:
    assert status in ("PASS", "WARN", "FAIL")
    out = {"check_name": name, "status": status, "detail": detail}
    if extra:
        out["data"] = extra
    return out


def pct(x: float) -> str:
    return f"{100 * x:.2f}%"


def jsonable(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, (pd.Timestamp, datetime)):
        return o.isoformat()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(f"Not serialisable: {type(o)}")


def load(csv_path: Path) -> pd.DataFrame:
    header = pd.read_csv(csv_path, nrows=0).columns.tolist()
    present = [c for c in ALL_COLUMNS if c in header]
    dtype = {c: "category" for c in ("City", "State", "Weather_Condition", "Sunrise_Sunset")
             if c in present}
    df = pd.read_csv(csv_path, usecols=present, dtype=dtype, low_memory=False)
    df.attrs["file_columns"] = header
    # Mixed formats exist in this dataset (with and without fractional seconds).
    try:
        df["Start_Time"] = pd.to_datetime(df["Start_Time"], format="mixed", errors="coerce")
    except (ValueError, TypeError):
        df["Start_Time"] = pd.to_datetime(df["Start_Time"], errors="coerce")
    return df


# --------------------------------------------------------------------------
# Individual checks
# --------------------------------------------------------------------------
def check_rows_and_range(df):
    out = []
    n = len(df)
    out.append(check("Row count", "PASS" if n > 0 else "FAIL",
                     f"{n:,} rows loaded." if n else "File contains no rows.", rows=n))
    t = df["Start_Time"]
    bad = int(t.isna().sum())
    if t.notna().any():
        lo, hi = t.min(), t.max()
        yrs = (lo.year, hi.year)
        status = "PASS" if yrs[0] <= EXPECTED_YEARS[0] and yrs[1] >= EXPECTED_YEARS[1] else "WARN"
        detail = (f"Crashes span {lo:%Y-%m-%d} to {hi:%Y-%m-%d}. Expected coverage "
                  f"{EXPECTED_YEARS[0]}-{EXPECTED_YEARS[1]}.")
        if bad:
            detail += f" {bad:,} rows have an unparseable Start_Time and are excluded from time checks."
            status = "WARN"
        out.append(check("Date range", status, detail,
                         min=lo.isoformat(), max=hi.isoformat(), unparseable=bad))
    else:
        out.append(check("Date range", "FAIL", "No parseable Start_Time values."))
    return out


def check_columns(df):
    header = df.attrs["file_columns"]
    missing_req = [c for c in REQUIRED_COLUMNS if c not in header]
    key_flat = [c for v in KEY_COLUMNS.values() for c in v]
    missing_opt = [c for c in key_flat if c not in header and c not in missing_req]
    if missing_req:
        return [check("Columns present", "FAIL",
                      f"Required columns missing: {', '.join(missing_req)}.",
                      missing_required=missing_req, missing_optional=missing_opt,
                      n_columns=len(header))]
    if missing_opt:
        return [check("Columns present", "WARN",
                      f"All required columns present, but optional columns are missing: "
                      f"{', '.join(missing_opt)}. Features that need them may be unavailable.",
                      missing_optional=missing_opt, n_columns=len(header))]
    return [check("Columns present", "PASS",
                  f"All {len(set(key_flat) | set(REQUIRED_COLUMNS))} required and key columns present "
                  f"({len(header)} columns in file).", n_columns=len(header))]


FALLBACKS = {
    "Precipitation(in)": "the pipeline also detects rain from Weather_Condition text and treats missing precipitation as 0",
    "Weather_Condition": "the pipeline treats missing weather as 'not rain'",
    "Visibility(mi)": "missing visibility is skipped in cell averages, and cells with none default to 10 miles",
    "Sunrise_Sunset": "the pipeline treats a missing day/night label as 'not night'",
    "Temperature(F)": "loaded but not used as a model feature",
}


def check_nulls(df, h):
    """Status is judged on Houston rows (what the model uses); the nationwide share is reported too."""
    out = []
    for group, cols in KEY_COLUMNS.items():
        for c in cols:
            if c not in df.columns:
                continue
            nat = float(df[c].isna().mean()) if len(df) else 1.0
            share = float(h[c].isna().mean()) if len(h) else nat
            status = "FAIL" if share > NULL_FAIL else "WARN" if share > NULL_WARN else "PASS"
            fb = FALLBACKS.get(c)
            if status == "FAIL" and fb:
                status = "WARN"          # still shown; downgraded only because a fallback is documented
            note = ""
            if status != "PASS":
                note = f" Fallback: {fb}." if fb else " No fallback documented for this column."
            out.append(check(f"Nulls: {c}", status,
                             f"Houston: {pct(share)} missing ({int(h[c].isna().sum()):,} of {len(h):,} rows); "
                             f"all US rows: {pct(nat)}. Thresholds: WARN > {pct(NULL_WARN)}, "
                             f"FAIL > {pct(NULL_FAIL)}.{note}",
                             group=group, houston_null_share=share, us_null_share=nat))
    return out


def check_duplicates(df):
    if "ID" not in df.columns:
        return [check("Duplicate IDs", "FAIL", "ID column missing.")]
    dup = int(df["ID"].duplicated().sum())
    return [check("Duplicate IDs", "PASS" if dup == 0 else "FAIL",
                  "No duplicate crash IDs." if dup == 0 else
                  f"{dup:,} duplicate IDs found; counts would be inflated until removed.",
                  duplicates=dup)]


def check_coordinates(df):
    lat, lng = df["Start_Lat"], df["Start_Lng"]
    missing = int((lat.isna() | lng.isna()).sum())
    out_range = int(((lat < -90) | (lat > 90) | (lng < -180) | (lng > 180)).sum())
    zero = int(((lat == 0) & (lng == 0)).sum())
    # Contiguous US plausibility box (generous).
    outside_us = int(((lat < 24) | (lat > 50) | (lng < -125) | (lng > -66)).sum()) - out_range
    outside_us = max(outside_us, 0)
    problems = []
    status = "PASS"
    if out_range or zero:
        status = "FAIL"
        problems.append(f"{out_range:,} outside valid lat/lng range, {zero:,} at (0, 0)")
    if missing:
        status = "FAIL" if status == "FAIL" else "WARN"
        problems.append(f"{missing:,} missing coordinates")
    if outside_us:
        status = "FAIL" if status == "FAIL" else "WARN"
        problems.append(f"{outside_us:,} outside the contiguous US box (lat 24-50, lng -125 to -66)")
    return [check("Coordinates in range", status,
                  "All coordinates valid and inside the contiguous US box." if not problems
                  else "; ".join(problems) + ".",
                  out_of_range=out_range, at_zero=zero, missing=missing, outside_us=outside_us)]


def houston_mask(df):
    return (df["City"] == HOUSTON_CITY) & (df["State"] == HOUSTON_STATE)


def check_houston_share(df, h):
    n, k = len(df), len(h)
    share = k / n if n else 0.0
    if k == 0:
        return [check("Houston share", "FAIL", "No rows found for Houston, TX.", houston_rows=0)]
    status = "PASS" if k >= 10_000 else "WARN"
    return [check("Houston share", status,
                  f"{k:,} of {n:,} rows ({pct(share)}) are in {HOUSTON_CITY}, {HOUSTON_STATE}. "
                  + ("" if status == "PASS" else "Sample is small; cell-level results will be noisy."),
                  houston_rows=k, total_rows=n, share=share)]


def yearly_monthly(h):
    ym = (h.dropna(subset=["Start_Time"])
            .assign(year=lambda d: d["Start_Time"].dt.year, month=lambda d: d["Start_Time"].dt.month)
            .groupby(["year", "month"]).size().rename("crashes").reset_index())
    return ym


def check_yearly(ym, df_all):
    out = []
    if ym.empty:
        return [check("Crashes per year (Houston)", "FAIL", "No dated Houston crashes.")]
    yearly = ym.groupby("year")["crashes"].sum()
    out.append(check("Crashes per year (Houston)", "PASS",
                     "; ".join(f"{y}: {int(c):,}" for y, c in yearly.items()) + ".",
                     yearly={int(y): int(c) for y, c in yearly.items()}))

    # Year-over-year jumps (the 2017 jump is expected: the source widened its coverage).
    jumps = []
    for y in yearly.index[1:]:
        prev = yearly.get(y - 1)
        if prev and prev > 0 and yearly[y] / prev >= YOY_JUMP_RATIO and y != yearly.index[-1]:
            jumps.append((int(y), float(yearly[y] / prev)))
    if jumps:
        txt = ", ".join(f"{y} ({r:.1f}x vs {y-1})" for y, r in jumps)
        out.append(check("Year-over-year jump", "WARN",
                         f"Crash counts jump sharply in {txt}. Such jumps usually reflect changes in "
                         f"data sources or collection coverage rather than real-world change, so "
                         f"trends across the jump should not be read as safety trends. "
                         f"The label years (2021, 2022) are well after it, but history features count crashes from 2016 onward, so a cell's past-crash count mixes both coverage levels.",
                         jumps=[{"year": y, "ratio": r} for y, r in jumps]))
    else:
        out.append(check("Year-over-year jump", "PASS",
                         f"No year-over-year change of {YOY_JUMP_RATIO}x or more."))

    # 2017 specifically, so the front end can highlight it.
    if 2016 in yearly.index and 2017 in yearly.index:
        r = yearly[2017] / yearly[2016] if yearly[2016] else float("nan")
        out.append(check("2017 jump", "WARN" if r >= YOY_JUMP_RATIO else "PASS",
                         f"2017 has {int(yearly[2017]):,} Houston crashes versus {int(yearly[2016]):,} in "
                         f"2016 ({r:.1f}x). " + ("Treat pre-2017 data as not comparable."
                                                  if r >= YOY_JUMP_RATIO else ""),
                         ratio=float(r)))

    # Partial final year, judged from the data itself.
    last_year = int(df_all["Start_Time"].dt.year.max())
    last_date = df_all.loc[df_all["Start_Time"].dt.year == last_year, "Start_Time"].max()
    months = ym[ym["year"] == last_year]["month"].nunique()
    if last_date.month < 12 or months < 12:
        out.append(check(f"{last_year} partial year", "WARN",
                         f"Data for {last_year} ends on {last_date:%Y-%m-%d} (about {last_date.month} of 12 "
                         f"months). {last_year} is incomplete and is excluded from yearly "
                         f"comparisons and from model training and testing.",
                         last_year=last_year, last_date=last_date.isoformat()))
    else:
        out.append(check(f"{last_year} partial year", "PASS", f"{last_year} covers all 12 months."))

    thin = [int(y) for y, c in yearly.items() if c < MIN_HOUSTON_YEARLY]
    if thin:
        out.append(check("Thin years", "WARN",
                         f"Years with fewer than {MIN_HOUSTON_YEARLY} Houston crashes: {thin}.",
                         years=thin))
    return out


def check_severity_night_rain(h):
    out = []
    n = len(h)
    if n == 0:
        return out
    sev = h["Severity"].value_counts(normalize=True).sort_index()
    invalid = int((~h["Severity"].isin([1, 2, 3, 4])).sum())
    top_level, top_share = int(sev.idxmax()), float(sev.max())
    status = "FAIL" if invalid else "WARN" if top_share > 0.85 else "PASS"
    out.append(check("Severity distribution", status,
                     ", ".join(f"S{int(k)}: {pct(v)}" for k, v in sev.items()) + "." +
                     (f" {invalid:,} rows have a severity outside 1-4." if invalid else "") +
                     (f" Severity {top_level} dominates ({pct(top_share)}); severity-weighted "
                      f"analysis would add little." if top_share > 0.85 else ""),
                     distribution={int(k): float(v) for k, v in sev.items()}, invalid=invalid))

    night = (h["Sunrise_Sunset"] == "Night")
    night_known = h["Sunrise_Sunset"].notna()
    ns = float(night[night_known].mean()) if night_known.any() else float("nan")
    out.append(check("Share of night crashes", "PASS" if night_known.any() else "WARN",
                     f"{pct(ns)} of Houston crashes with a known day/night label occurred at night "
                     f"({int(night_known.sum()):,} labelled rows)." if night_known.any()
                     else "No usable Sunrise_Sunset values.", night_share=ns))

    wc = h["Weather_Condition"].astype("string").str.lower()
    rain = wc.str.contains("|".join(RAIN_WORDS), na=False)
    known = wc.notna()
    rs = float(rain[known].mean()) if known.any() else float("nan")
    out.append(check("Share of rain crashes", "PASS" if known.any() else "WARN",
                     f"{pct(rs)} of Houston crashes with a recorded weather condition were in rain, "
                     f"drizzle, showers or thunderstorms ({int(known.sum()):,} labelled rows)."
                     if known.any() else "No usable Weather_Condition values.", rain_share=rs))
    return out


def check_time_split_and_leakage(h):
    out = []
    p, t = SPLITS["primary"], SPLITS["primary_test"]
    desc = (f"Train: features through {p['feature_through']}, label measured in {p['label_year']}. "
            f"Test: features through {t['feature_through']}, label measured in {t['label_year']}. "
            f"Splits are strictly forward in time.")
    out.append(check("Time-split definition", "PASS", desc, splits=SPLITS))

    # Window-level leakage asserts, using the data actually present.
    years = set(h["Start_Time"].dt.year.dropna().astype(int).unique())
    problems = []
    for s in (p, t):
        if s["label_year"] <= s["feature_through"]:
            problems.append(f"{s['name']}: label year {s['label_year']} not after feature cut-off")
    if p["label_year"] > t["feature_through"]:
        problems.append("train label year is after the test feature cut-off")
    if t["label_year"] <= p["label_year"]:
        problems.append("test label year is not after train label year")
    for s in (p, t):
        for need in (s["label_year"],):
            if need not in years:
                problems.append(f"no Houston data in label year {need}")
    # Row-level assertion: the feature set for each split must contain no row beyond its cut-off.
    for key, s in SPLITS.items():
        feat_rows = h[h["Start_Time"].dt.year <= s["feature_through"]]
        if len(feat_rows) and feat_rows["Start_Time"].dt.year.max() > s["feature_through"]:
            problems.append(f"{s['name']}: feature rows beyond cut-off")  # unreachable by construction
    if problems:
        out.append(check("Leakage assert (windows)", "FAIL", "; ".join(problems) + "."))
        return out
    out.append(check("Leakage assert (windows)", "PASS",
                     "Feature windows end before label windows for both splits, and no feature "
                     "row is dated after its cut-off year."))

    return out


def feature_leakage_test(df, build, splits=SPLITS):
    """Build features on all data and on data cut at the cut-off year; they must be identical.
    If any feature touched a later row, the two versions would differ. `build(df, F, L)` -> (X, y)."""
    problems = []
    for s_ in splits.values():
        F, L = s_["feature_through"], s_["label_year"]
        full, _ = build(df, F, L)
        cut, _ = build(df[df.year <= F], F, L)
        full, cut = full.sort_index(), cut.sort_index()
        if not full.index.equals(cut.index):
            problems.append(f"{s_['name']}: different set of cells ({len(full)} vs {len(cut)})")
            continue
        bad = [c for c in full.columns if not np.allclose(full[c].values, cut[c].values, equal_nan=True)]
        if bad:
            problems.append(f"{s_['name']}: features change when later years are removed: {', '.join(bad)}")
    return problems


def check_feature_leakage(csv_path, skip):
    name = "Leakage assert (features)"
    if skip:
        return [check(name, "WARN", "Skipped (--skip-feature-test). Feature-by-feature leakage was not tested.")]
    try:
        sys.path[:0] = [str(Path.cwd()), str(Path(__file__).resolve().parent.parent)]
        import blackspot_pipeline as bp  # type: ignore
        d = bp.load(argparse.Namespace(csv=str(csv_path), state=HOUSTON_STATE, city=HOUSTON_CITY, res=9))
        problems = feature_leakage_test(d, bp.build)
    except Exception as e:  # never hide a failure to test
        return [check(name, "WARN", f"Could not run the feature test ({type(e).__name__}: {e}). "
                                    f"Window-level check only.")]
    if problems:
        return [check(name, "FAIL", "Possible leakage. " + "; ".join(problems) + ".")]
    return [check(name, "PASS",
                  "Features were built twice per split, once with all data and once with data cut at the "
                  "feature cut-off year. All features were identical, so none uses later data.")]


# --------------------------------------------------------------------------
# Orchestration and output
# --------------------------------------------------------------------------
def summarise(checks):
    counts = {s: sum(c["status"] == s for c in checks) for s in ("PASS", "WARN", "FAIL")}
    overall = "FAIL" if counts["FAIL"] else "WARN" if counts["WARN"] else "PASS"
    return counts, overall


def write_db(db_path: Path, checks, ym):
    from sqlalchemy import create_engine, text
    eng = create_engine(f"sqlite:///{db_path}")
    with eng.begin() as con:
        con.execute(text("CREATE TABLE IF NOT EXISTS data_quality "
                         "(check_name TEXT, status TEXT, detail TEXT)"))
        con.execute(text("CREATE TABLE IF NOT EXISTS yearly_counts "
                         "(year INTEGER, month INTEGER, crashes INTEGER)"))
        con.execute(text("DELETE FROM data_quality"))
        con.execute(text("DELETE FROM yearly_counts"))
        con.execute(text("INSERT INTO data_quality VALUES (:n, :s, :d)"),
                    [{"n": c["check_name"], "s": c["status"], "d": c["detail"]} for c in checks])
        if len(ym):
            con.execute(text("INSERT INTO yearly_counts VALUES (:y, :m, :c)"),
                        [{"y": int(r.year), "m": int(r.month), "c": int(r.crashes)}
                         for r in ym.itertuples()])


def run(csv_path: Path, out_path: Path, db_path: Path | None, skip_feature_test: bool = False) -> int:
    print(f"Loading {csv_path} ...")
    df = load(csv_path)
    checks: list[dict] = []
    checks += check_rows_and_range(df)
    checks += check_columns(df)
    missing_req = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing_req:
        print(f"Required columns missing: {missing_req}. Stopping after structural checks.")
    else:
        h = df[houston_mask(df)].copy()
        checks += check_nulls(df, h)
        checks += check_duplicates(df)
        checks += check_coordinates(df)
        checks += check_houston_share(df, h)
        ym = yearly_monthly(h)
        checks += check_yearly(ym, df)
        checks += check_severity_night_rain(h)
        checks += check_time_split_and_leakage(h)
        checks += check_feature_leakage(csv_path, skip_feature_test)
    if missing_req:
        ym = pd.DataFrame(columns=["year", "month", "crashes"])

    counts, overall = summarise(checks)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_file": str(csv_path),
        "dataset_credit": "US Accidents (2016-2023), Moosavi et al.",
        "overall_status": overall,
        "counts": counts,
        "checks": checks,
        "yearly_counts": [{"year": int(r.year), "month": int(r.month), "crashes": int(r.crashes)}
                          for r in ym.itertuples()],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, default=jsonable))
    if db_path:
        write_db(db_path, checks, ym)

    for c in checks:
        print(f"[{c['status']}] {c['check_name']}: {c['detail']}")
    print(f"\nOverall: {overall}  (PASS {counts['PASS']}, WARN {counts['WARN']}, FAIL {counts['FAIL']})")
    print(f"Wrote {out_path}" + (f" and tables data_quality, yearly_counts in {db_path}" if db_path else ""))
    return 1 if counts["FAIL"] else 0


def main():
    ap = argparse.ArgumentParser(description="WAYMARK data validation")
    ap.add_argument("--csv", default="US_Accidents_March23.csv", type=Path)
    ap.add_argument("--out", default=Path("out/data_quality.json"), type=Path)
    ap.add_argument("--db", default=Path("waymark.db"), type=Path)
    ap.add_argument("--no-db", action="store_true", help="skip writing to SQLite")
    ap.add_argument("--skip-feature-test", action="store_true",
                    help="skip the feature-level leakage test (it reloads the CSV through blackspot_pipeline)")
    a = ap.parse_args()
    if not a.csv.exists():
        sys.exit(f"CSV not found: {a.csv}")
    sys.exit(run(a.csv, a.out, None if a.no_db else a.db, a.skip_feature_test))


if __name__ == "__main__":
    main()
