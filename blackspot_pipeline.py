"""
AI-17 Road Accident Blackspot Prediction - pipeline for the US Accidents CSV.

Usage:
  python blackspot_pipeline.py --csv US_Accidents_March23.csv --state TX --city Houston
  (omit --state/--city to auto-pick the city with the most records)

Outputs (in ./out):
  cell_scores.csv   one row per H3 cell: risk score, confidence, top factors, advice
  model.joblib      trained model + feature list (for the web app)
  metrics.json      validation numbers for your slides

Design (CSV-only MVP):
  features come from crash history up to year F, label = "blackspot" = at least --min-crashes crashes in year F+1 (default 3).
  Training backtest: features<=2020 -> label 2021. Test backtest: features<=2021 -> label 2022.
  Only cells with >=1 past crash exist in this data, so "low-history" = 1-2 past crashes.
"""
import argparse, json, os, warnings
import numpy as np, pandas as pd, h3, joblib, shap, lightgbm as lgb
from sklearn.metrics import roc_auc_score

from pipeline.advice import apply_advice   # evidence-gated factors and actions (see pipeline/advice.py)

warnings.filterwarnings("ignore", category=UserWarning)

COLS = ["ID", "Severity", "Start_Time", "Start_Lat", "Start_Lng", "City", "State",
        "Visibility(mi)", "Temperature(F)", "Precipitation(in)", "Weather_Condition",
        "Sunrise_Sunset", "Junction", "Crossing", "Traffic_Signal", "Stop", "Give_Way",
        "Railway", "Roundabout", "Bump", "Traffic_Calming", "Station", "Amenity"]
FLAGS = ["Junction", "Crossing", "Traffic_Signal", "Stop", "Give_Way", "Railway",
         "Roundabout", "Bump", "Traffic_Calming", "Station", "Amenity"]

def cell_of(lat, lng, res):
    return h3.latlng_to_cell(lat, lng, res)


def load(args):
    df = pd.read_csv(args.csv, usecols=lambda c: c in COLS)
    df["Start_Time"] = pd.to_datetime(df["Start_Time"], format="mixed", errors="coerce")
    df = df.dropna(subset=["Start_Time", "Start_Lat", "Start_Lng"])
    if args.state: df = df[df.State == args.state]
    if args.city: df = df[df.City == args.city]
    else:
        top = df.groupby(["State", "City"]).size().sort_values(ascending=False).index[0]
        df = df[(df.State == top[0]) & (df.City == top[1])]
        print("Auto-picked city:", top)
    df = df.copy()
    df["year"] = df.Start_Time.dt.year
    df["night"] = (df.get("Sunrise_Sunset", "Day") == "Night").astype(float)
    wc = df.get("Weather_Condition", pd.Series("", index=df.index)).fillna("").str.lower()
    pr = df.get("Precipitation(in)", pd.Series(0, index=df.index)).fillna(0)
    df["rain"] = (wc.str.contains("rain|drizzle|storm|snow|shower") | (pr > 0)).astype(float)
    for f in FLAGS:
        df[f] = df[f].astype(float) if f in df else 0.0
    df["vis"] = df["Visibility(mi)"] if "Visibility(mi)" in df else 10.0
    df["cell"] = [cell_of(a, b, args.res) for a, b in zip(df.Start_Lat, df.Start_Lng)]
    return df


def build(df, feat_end, target_year, min_crashes=3):
    """Features from crashes with year<=feat_end; label = >=min_crashes crashes in target_year."""
    hist = df[df.year <= feat_end]
    g = hist.groupby("cell")
    X = pd.DataFrame({
        "n_acc": g.size(),
        "n_recent": hist[hist.year >= feat_end - 1].groupby("cell").size(),
        "mean_sev": g["Severity"].mean() if "Severity" in hist else 2.0,
        "share_night": g["night"].mean(),
        "share_rain": g["rain"].mean(),
        "mean_vis": g["vis"].mean(),
    })
    for f in FLAGS:
        X[f] = g[f].mean()
    X["n_recent"] = X["n_recent"].fillna(0)
    X["mean_vis"] = X["mean_vis"].fillna(10.0)
    # neighbour crashes (blackspots cluster): sum over the ring-1 neighbours
    counts = X["n_acc"].to_dict()
    X["nb_acc"] = [sum(counts.get(n, 0) for n in h3.grid_disk(c, 1) if n != c) for c in X.index]
    nxt = df[df.year == target_year].groupby("cell").size()
    y = (nxt.reindex(X.index).fillna(0) >= min_crashes).astype(int)
    return X.fillna(0), y


def prec_at(y, p, frac):
    k = max(1, int(len(y) * frac))
    idx = np.argsort(-np.asarray(p))[:k]
    return float(np.asarray(y)[idx].mean())


def recall_at(y, p, frac):
    k = max(1, int(len(y) * frac))
    idx = np.argsort(-np.asarray(p))[:k]
    return float(np.asarray(y)[idx].sum() / max(1, np.asarray(y).sum()))


def evaluate(y, p, base, label):
    out = {"cells": int(len(y)), "positive_rate": float(np.mean(y))}
    if len(set(y)) > 1:
        out.update(auc_model=float(roc_auc_score(y, p)), auc_history_baseline=float(roc_auc_score(y, base)),
                   precision_top5_model=prec_at(y, p, .05), precision_top5_baseline=prec_at(y, base, .05),
                   capture_top10_model=recall_at(y, p, .10), capture_top10_baseline=recall_at(y, base, .10))
    print(label, json.dumps({k: round(v, 3) if isinstance(v, float) else v for k, v in out.items()}))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--state"); ap.add_argument("--city")
    ap.add_argument("--res", type=int, default=9, help="H3 resolution (try 8 if few positives)")
    ap.add_argument("--target", type=int, default=2022, help="last full year in the data")
    ap.add_argument("--min-crashes", type=int, default=3,
                    help="a cell is a blackspot if it has at least this many crashes next year")
    ap.add_argument("--out", default="out")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    df = load(args)
    print("\nCrashes per year (a sudden jump may be a data-collection change, not real risk):")
    print(df.year.value_counts().sort_index().to_string(), "\n")

    T = args.target
    Xtr, ytr = build(df, T - 2, T - 1, args.min_crashes)   # train backtest
    Xte, yte = build(df, T - 1, T, args.min_crashes)     # test backtest
    feats = list(Xtr.columns)
    print(f"Train cells {len(Xtr)} (positive {ytr.mean():.1%}), test cells {len(Xte)} (positive {yte.mean():.1%})")

    def fit(seed):
        return lgb.LGBMClassifier(n_estimators=300, learning_rate=0.05, num_leaves=15, min_child_samples=20,
                                  subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                                  random_state=seed, verbose=-1).fit(Xtr[feats], ytr)
    models = [fit(s) for s in (0, 1, 2)]
    P = np.column_stack([m.predict_proba(Xte[feats])[:, 1] for m in models])
    p, p_std = P.mean(1), P.std(1)
    base = Xte["n_acc"].values  # history-only baseline

    metrics = {"all_cells": evaluate(yte.values, p, base, "ALL CELLS      ")}
    low = (Xte["n_acc"] <= 2).values
    metrics["low_history_cells"] = evaluate(yte.values[low], p[low], base[low], "LOW-HISTORY    ")

    # ---- score, confidence, explanation, advice
    risk = pd.Series(p).rank(pct=True).values * 100
    hist_pct = pd.Series(base).rank(pct=True).values * 100
    sv = shap.TreeExplainer(models[0]).shap_values(Xte[feats])
    sv = sv[1] if isinstance(sv, list) else sv
    sv = np.asarray(sv)
    if sv.ndim == 3: sv = sv[:, :, 1]
    n = Xte["n_acc"].values
    similar = pd.Series(p).groupby(np.digitize(n, [3, 10])).rank(pct=True).values * 100  # vs similar-history cells
    conf = np.where(n >= 5, 2, np.where(n >= 3, 1, 0))
    conf = np.where(p_std > np.quantile(p_std, .75), np.maximum(conf - 1, 0), conf)
    # emerging risk = top decile of model score among LOW-HISTORY cells (<=2 past crashes)
    lowmask = n <= 2
    thr = np.quantile(p[lowmask], 0.90) if lowmask.any() else np.inf
    emerging = lowmask & (p >= thr)
    out = pd.DataFrame({
        "cell": Xte.index,
        "lat": [h3.cell_to_latlng(c)[0] for c in Xte.index],
        "lng": [h3.cell_to_latlng(c)[1] for c in Xte.index],
        "n_past_crashes": n, "risk_score": risk.round(1), "risk_vs_similar_history": similar.round(1), "history_percentile": hist_pct.round(1),
        "confidence": pd.Series(conf).map({0: "Low", 1: "Medium", 2: "High"}).values,
        "top_factors": "", "recommendations": "",
        "emerging_risk": emerging})
    # factors and actions: only where the model AND the cell's own crash records agree (pipeline/advice.py)
    audit = out.emerging_risk.to_numpy() | (out.risk_score.rank(ascending=False, method="first") <= 300).to_numpy()
    out, _ = apply_advice(out, Xte, sv, feats, audit)
    out.sort_values("risk_score", ascending=False).to_csv(f"{args.out}/cell_scores.csv", index=False)
    Xte.to_csv(f"{args.out}/cell_features.csv")
    joblib.dump({"models": models, "features": feats}, f"{args.out}/model.joblib")
    json.dump(metrics, open(f"{args.out}/metrics.json", "w"), indent=2)
    print(f"\nEmerging-risk cells (<=2 past crashes, top 10% of model score among them): {int(out.emerging_risk.sum())}")
    print(out[out.emerging_risk].sort_values("risk_score", ascending=False).head(5).to_string(index=False))
    print(f"\nSaved to ./{args.out}/  (cell_scores.csv, cell_features.csv, model.joblib, metrics.json)")


if __name__ == "__main__":
    main()