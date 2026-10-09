#!/usr/bin/env python3
"""
WAYMARK | pipeline/export_results.py

Reads the artefacts from your existing pipeline run (out/cell_scores.csv,
out/cell_features.csv, out/metrics.json, out/model.joblib) and the raw CSV,
and writes flat files for pipeline/load_db.py into out/export/:

  cells.csv            one row per cell (+ baseline_prob)
  cell_shap.csv        top-6 SHAP contributions for every emerging-risk cell and the top 300 cells
  cell_scenarios.csv   probability for all 8 combinations of night / rain / low_vis, every cell
  metrics_rows.csv     rows for the `metrics` table (overall, low-history, robustness, second split, bootstrap)
  export_summary.json  integrity checks and counts

The saved model is NOT retrained. The only models trained here are the ones the
robustness and second-split analyses need (different labels / different years),
using the same hyper-parameters and seeds as blackspot_pipeline.py.

Run from the folder that contains blackspot_pipeline.py:
    python pipeline/export_results.py --csv US_Accidents_March23.csv --out out
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
import shap
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path.cwd()))
import blackspot_pipeline as bp  # noqa: E402  (the user's own pipeline)

SEEDS = (0, 1, 2)
LOW_HISTORY_MAX = 2                 # same definition as the pipeline: <= 2 past crashes
TOP_N_CELLS = 300
TOP_K_SHAP = 6
LOW_VIS_VALUE = 1.0                 # scenario override for mean_vis (worse than most cells)
BOOTSTRAP_B = 2000
BOOTSTRAP_SEED = 42


# --------------------------------------------------------------------------
# Model helpers (same settings as blackspot_pipeline.main)
# --------------------------------------------------------------------------
def fit_models(X, y, feats):
    return [lgb.LGBMClassifier(n_estimators=300, learning_rate=0.05, num_leaves=15, min_child_samples=20,
                               subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                               random_state=s, verbose=-1).fit(X[feats], y) for s in SEEDS]


def predict(models, X, feats):
    return np.mean([m.predict_proba(X[feats])[:, 1] for m in models], axis=0)


def shap_matrix(model, X, feats):
    sv = shap.TreeExplainer(model).shap_values(X[feats])
    sv = sv[1] if isinstance(sv, list) else sv
    sv = np.asarray(sv)
    if sv.ndim == 3:
        sv = sv[:, :, 1]
    return sv


# --------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------
def metric_block(y, p, base):
    """Same metrics as the pipeline's evaluate(), without printing."""
    y, p, base = np.asarray(y), np.asarray(p), np.asarray(base)
    out = {"cells": int(len(y)), "blackspots": int(y.sum()), "positive_rate": float(y.mean()) if len(y) else None}
    if 0 < y.sum() < len(y):
        out.update(
            auc=(float(roc_auc_score(y, p)), float(roc_auc_score(y, base))),
            precision_top5=(bp.prec_at(y, p, .05), bp.prec_at(y, base, .05)),
            capture_top10=(bp.recall_at(y, p, .10), bp.recall_at(y, base, .10)),
            history_capture_top10_tie_avg=recall_tieavg(y, base, .10),
        )
    return out


def rows_from_block(group, block, **extra):
    rows = []
    base_extra = {k: block[k] for k in ("cells", "blackspots", "positive_rate", "history_capture_top10_tie_avg")
                  if k in block}
    base_extra.update(extra)
    for name in ("auc", "precision_top5", "capture_top10"):
        if name in block:
            m, h = block[name]
            rows.append({"group_name": group, "metric_name": name, "model_value": m, "history_value": h,
                         "extra_json": json.dumps(base_extra)})
    if not rows:  # no usable metric (e.g. no positives)
        rows.append({"group_name": group, "metric_name": "n/a", "model_value": None, "history_value": None,
                     "extra_json": json.dumps({**base_extra, "note": "no positives or all positives"})})
    return rows


def backtest(df, T, min_crashes, models=None):
    """Train on (<=T-2 -> T-1), test on (<=T-1 -> T). Returns overall and low-history blocks."""
    Xtr, ytr = bp.build(df, T - 2, T - 1, min_crashes)
    Xte, yte = bp.build(df, T - 1, T, min_crashes)
    feats = list(Xtr.columns)
    models = models or fit_models(Xtr, ytr, feats)
    p = predict(models, Xte, feats)
    base = Xte["n_acc"].values
    low = (Xte["n_acc"] <= LOW_HISTORY_MAX).values
    return (metric_block(yte.values, p, base),
            metric_block(yte.values[low], p[low], base[low]),
            dict(Xte=Xte, yte=yte, p=p, low=low))


def recall_tieavg(y, score, frac):
    """Expected recall in the top `frac` when tied scores are broken at random.
    The history baseline (past crash count) has huge ties among 1- and 2-crash cells, so a plain
    argsort makes the answer depend on row order. This removes that dependence."""
    y, score = np.asarray(y), np.asarray(score)
    k = max(1, int(len(y) * frac))
    thr = np.sort(score)[::-1][k - 1]
    above, tied = score > thr, score == thr
    need = k - int(above.sum())
    exp = y[above].sum() + (y[tied].mean() * need if tied.any() else 0.0)
    return float(exp / max(1, y.sum()))


def bootstrap_capture(y, p, base, B=BOOTSTRAP_B, seed=BOOTSTRAP_SEED):
    """Percentile bootstrap over low-history cells for capture@top10% (model, history, difference)."""
    rng = np.random.default_rng(seed)
    y, p, base = map(np.asarray, (y, p, base))
    n = len(y)
    m, h = [], []
    for _ in range(B):
        idx = rng.integers(0, n, n)
        if y[idx].sum() == 0:
            continue
        m.append(bp.recall_at(y[idx], p[idx], .10))
        h.append(recall_tieavg(y[idx], base[idx], .10))
    m, h = np.array(m), np.array(h)
    q = lambda a: [float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))]
    return {
        "B": int(len(m)), "seed": seed, "n_cells": int(n), "n_blackspots": int(y.sum()),
        "model": {"point": bp.recall_at(y, p, .10), "ci95": q(m)},
        "history": {"point": recall_tieavg(y, base, .10), "ci95": q(h), "note": "ties in past-crash count broken at random (expected value)"},
        "difference": {"point": bp.recall_at(y, p, .10) - recall_tieavg(y, base, .10), "ci95": q(m - h),
                       "share_resamples_model_better": float((m > h).mean())},
    }


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--state", default="TX")
    ap.add_argument("--city", default="Houston")
    ap.add_argument("--res", type=int, default=9)
    ap.add_argument("--target", type=int, default=2022)
    ap.add_argument("--min-crashes", type=int, default=3)
    ap.add_argument("--out", default="out", type=Path)
    ap.add_argument("--bootstrap", type=int, default=BOOTSTRAP_B)
    a = ap.parse_args()

    exp = a.out / "export"
    exp.mkdir(parents=True, exist_ok=True)
    summary: dict = {"integrity": []}

    def note(name, ok, detail):
        summary["integrity"].append({"check": name, "status": "PASS" if ok else "WARN", "detail": detail})
        print(f"[{'PASS' if ok else 'WARN'}] {name}: {detail}")

    # ---- 1. existing artefacts
    scores = pd.read_csv(a.out / "cell_scores.csv")
    feats_df = pd.read_csv(a.out / "cell_features.csv", index_col=0)
    saved_metrics = json.load(open(a.out / "metrics.json"))
    bundle = joblib.load(a.out / "model.joblib")
    models, feats = bundle["models"], bundle["features"]

    same_cells = set(scores["cell"]) == set(feats_df.index)
    note("Cells match", same_cells, f"{len(scores):,} scored cells, {len(feats_df):,} feature rows.")
    if not same_cells:
        sys.exit("cell_scores.csv and cell_features.csv describe different cells; re-run the pipeline.")
    feats_df = feats_df.loc[scores["cell"]]            # align to the score file order

    p = predict(models, feats_df, feats)
    scores["baseline_prob"] = p

    # The saved scores must be reproducible from the saved model (risk_score = percentile of model prob).
    rho = pd.Series(p).corr(scores["risk_score"].reset_index(drop=True), method="spearman")
    note("Saved model reproduces saved scores", rho > 0.99,
         f"Spearman correlation between recomputed probability and risk_score = {rho:.4f}.")

    # ---- 2. cells.csv
    cells = scores.rename(columns={"cell": "cell_id"})[
        ["cell_id", "lat", "lng", "n_past_crashes", "risk_score", "risk_vs_similar_history",
         "history_percentile", "confidence", "top_factors", "recommendations", "emerging_risk",
         "baseline_prob"]].copy()
    cells["emerging_risk"] = cells["emerging_risk"].astype(int)
    cells.to_csv(exp / "cells.csv", index=False)

    # ---- 3. SHAP for emerging-risk cells and the top 300 cells
    order = cells.sort_values(["risk_score", "baseline_prob"], ascending=False)
    top_ids = list(order["cell_id"].head(TOP_N_CELLS))
    em_ids = list(cells.loc[cells["emerging_risk"] == 1, "cell_id"])
    sel = list(dict.fromkeys(top_ids + em_ids))
    Xsel = feats_df.loc[sel]
    sv = shap_matrix(models[0], Xsel, feats)     # models[0] is what the pipeline used for top_factors
    rows = []
    for i, cid in enumerate(sel):
        idx = np.argsort(-np.abs(sv[i]))[:TOP_K_SHAP]
        for rank, j in enumerate(idx, 1):
            rows.append({"cell_id": cid, "feature": feats[j], "feature_value": float(Xsel.iloc[i, Xsel.columns.get_loc(feats[j])]),
                         "shap_value": float(sv[i, j]), "rank": rank})
    pd.DataFrame(rows).to_csv(exp / "cell_shap.csv", index=False)
    note("SHAP exported", True, f"{len(sel):,} cells ({len(top_ids)} top + {len(em_ids)} emerging, "
                                f"overlap removed), top {TOP_K_SHAP} features each, from model seed 0.")

    # ---- 4. scenarios: only toggled-on factors are overridden; "off" means as recorded
    srows = []
    for night, rain, low_vis in itertools.product((0, 1), repeat=3):
        X = feats_df.copy()
        if night: X["share_night"] = 1.0
        if rain: X["share_rain"] = 1.0
        if low_vis: X["mean_vis"] = LOW_VIS_VALUE
        pr = predict(models, X, feats)
        srows.append(pd.DataFrame({"cell_id": feats_df.index, "night": night, "rain": rain,
                                   "low_vis": low_vis, "probability": pr}))
    scen = pd.concat(srows, ignore_index=True)
    scen.to_csv(exp / "cell_scenarios.csv", index=False)
    s0 = scen[(scen.night == 0) & (scen.rain == 0) & (scen.low_vis == 0)].set_index("cell_id")["probability"]
    note("Scenario baseline equals model output", bool(np.allclose(s0.loc[cells.cell_id].values, p)),
         f"{len(scen):,} scenario rows (8 combinations x {len(feats_df):,} cells); low_vis sets mean_vis={LOW_VIS_VALUE}.")

    # ---- 5. metrics (needs the raw CSV)
    print("\nLoading raw crashes for validation metrics ...")
    df = bp.load(argparse.Namespace(csv=a.csv, state=a.state, city=a.city, res=a.res))
    T, N = a.target, a.min_crashes
    metric_rows: list[dict] = []

    # 5a. headline: reuse the SAVED model on the test backtest, compare with saved metrics.json
    Xte, yte = bp.build(df, T - 1, T, N)
    p_te = predict(models, Xte, feats)
    base_te = Xte["n_acc"].values
    low_te = (Xte["n_acc"] <= LOW_HISTORY_MAX).values
    overall = metric_block(yte.loc[Xte.index].values, p_te, base_te)
    lowh = metric_block(yte.loc[Xte.index].values[low_te], p_te[low_te], base_te[low_te])
    match = (abs(overall["auc"][0] - saved_metrics["all_cells"]["auc_model"]) < 1e-6 and
             abs(lowh["capture_top10"][0] - saved_metrics["low_history_cells"]["capture_top10_model"]) < 1e-6 and
             abs(lowh["capture_top10"][1] - saved_metrics["low_history_cells"]["capture_top10_baseline"]) < 1e-6)
    note("Recomputed metrics match metrics.json", match,
         "Headline metrics reproduce exactly from the saved model." if match else
         "Recomputed headline metrics differ from metrics.json (different CSV or settings?). "
         "The recomputed values are the ones exported.")
    metric_rows += rows_from_block("overall", overall, split=f"features<={T-1}, label {T}", min_crashes=N)
    metric_rows += rows_from_block("low_history", lowh, split=f"features<={T-1}, label {T}",
                                   min_crashes=N, definition=f"<= {LOW_HISTORY_MAX} past crashes")

    # 5b. robustness to the blackspot definition (retrain per N; N equal to the headline reuses the saved model)
    for n in (2, 3, 5):
        if n == N:
            ov, lo = overall, lowh
        else:
            ov, lo, _ = backtest(df, T, n)
        metric_rows += rows_from_block(f"robustness_N{n}", lo, scope="low_history", min_crashes=n,
                                       overall_auc=list(ov.get("auc", [])), overall_capture_top10=list(ov.get("capture_top10", [])))
        print(f"  robustness N={n}: low-history blackspots={lo['blackspots']}")

    # 5c. second backtest split, one year earlier
    ov2, lo2, _ = backtest(df, T - 1, N)
    sp = f"train features<={T-3} label {T-2}; test features<={T-2} label {T-1}"
    metric_rows += rows_from_block("second_split_overall", ov2, split=sp, min_crashes=N,
                                   caveat=f"label year {T-1} may be affected by 2020-era traffic" if T - 1 == 2021 else "")
    metric_rows += rows_from_block("second_split_low_history", lo2, split=sp, min_crashes=N)

    # 5d. bootstrap intervals for capture@top10% on low-history cells
    boot = bootstrap_capture(yte.loc[Xte.index].values[low_te], p_te[low_te], base_te[low_te], B=a.bootstrap)
    metric_rows.append({"group_name": "bootstrap_low_history", "metric_name": "capture_top10",
                        "model_value": boot["model"]["point"], "history_value": boot["history"]["point"],
                        "extra_json": json.dumps(boot)})
    print(f"  bootstrap capture@top10% (low-history): model {boot['model']['point']:.3f} "
          f"CI {boot['model']['ci95']}, history {boot['history']['point']:.3f} CI {boot['history']['ci95']}, "
          f"diff CI {boot['difference']['ci95']}")

    pd.DataFrame(metric_rows).to_csv(exp / "metrics_rows.csv", index=False)

    summary.update({
        "cells": int(len(cells)), "low_history_cells": int((cells.n_past_crashes <= LOW_HISTORY_MAX).sum()),
        "emerging_risk_cells": int(cells.emerging_risk.sum()),
        "scenario_rows": int(len(scen)), "shap_rows": len(rows), "metric_rows": len(metric_rows),
        "bootstrap": boot,
        "scoring_basis": f"Scores use features through {T-1} and are evaluated against {T}. "
                         f"They are a backtest-year scoring, not a forecast for {T+1}.",
    })
    json.dump(summary, open(exp / "export_summary.json", "w"), indent=2)
    print(f"\nWrote {exp}/ (cells, cell_shap, cell_scenarios, metrics_rows, export_summary)")


if __name__ == "__main__":
    main()
