"""The suggested actions must be backed by the cell's own crash records."""
import numpy as np
import pandas as pd

from pipeline.advice import BASIS_MARK, FALLBACK, apply_advice

FEATS = ["n_acc", "n_recent", "mean_sev", "share_night", "share_rain", "mean_vis", "Junction", "Crossing",
         "Traffic_Signal", "Stop", "Give_Way", "Railway", "Roundabout", "Bump", "Traffic_Calming", "Station",
         "Amenity", "nb_acc"]


def _frame(rows):
    base = dict.fromkeys(FEATS, 0.0) | {"n_acc": 1.0, "mean_sev": 2.0, "mean_vis": 9.0, "nb_acc": 49.0}
    # city reference rows keep the Houston-wide night share at 0.2 and median n_acc at 6
    ref = [base | {"n_acc": 6.0, "n_recent": 2.0, "share_night": 0.2, "mean_vis": 9.0} for _ in range(8)]
    return pd.DataFrame(ref + [base | r for r in rows], columns=FEATS)


def _run(rows, push, audit=False):
    X = _frame(rows)
    sv = np.zeros((len(X), len(FEATS)))
    for feat, k in push.items():                       # model pushes these features' scores UP for the last cell
        sv[-1, FEATS.index(feat)] = k
    mask = np.zeros(len(X), dtype=bool)
    mask[-1] = audit
    cells = pd.DataFrame({"cell_id": [f"c{i}" for i in range(len(X))], "top_factors": "", "recommendations": ""})
    out, rep = apply_advice(cells, X, sv, FEATS, mask)
    return out.iloc[-1], rep


def test_absent_condition_gets_no_action():
    # Crossing=0 and no night crashes, yet the model pushes both up: nothing may be suggested.
    row, _ = _run([{}], {"Crossing": 0.5, "share_night": 0.4})
    assert row.recommendations == ""
    assert row.top_factors == "none dominant"


def test_present_condition_gets_action_with_basis():
    row, _ = _run([{"n_acc": 4.0, "Crossing": 0.5}], {"Crossing": 0.5})
    assert row.top_factors == "Crossing"
    assert "pedestrian crossing" in row.recommendations
    assert BASIS_MARK in row.recommendations and "2 of 4 past crashes" in row.recommendations


def test_night_must_exceed_city_share():
    low, _ = _run([{"n_acc": 5.0, "share_night": 0.2}], {"share_night": 0.5})     # same as the city: no
    high, _ = _run([{"n_acc": 5.0, "share_night": 0.6}], {"share_night": 0.5})    # clearly above: yes
    assert low.recommendations == ""
    assert "street lighting" in high.recommendations and "3 of 5" in high.recommendations


def test_audit_flagged_cell_without_evidence_gets_honest_fallback():
    row, rep = _run([{}], {"Amenity": 0.5}, audit=True)
    assert row.recommendations == FALLBACK
    assert rep["cells_with_audit_fallback_only"] == 1


def test_non_positive_shap_never_listed():
    row, _ = _run([{"n_acc": 4.0, "Crossing": 0.5}], {"Crossing": -0.5})
    assert row.recommendations == ""
