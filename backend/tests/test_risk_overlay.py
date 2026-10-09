"""S2 (pure): the risk overlay formulas with exact numbers. No database."""
from types import SimpleNamespace as M

import pytest

from backend.risk_overlay import (adjusted_region_index, adjusted_score, combined_credit, implementation_pct,
                                  projected_credit, stage_factor, verified_pct)

CAP = 0.6                                     # effects.json credit_cap


def m(status, w=0.1):
    return M(status=status, effect_weight_snapshot=w)


def test_stage_factors_come_from_effects_json():
    assert [stage_factor(s) for s in ("planned", "in_progress", "evidence_submitted", "verified")] == [0.0, 0.25, 0.75, 1.0]
    assert stage_factor("cancelled") == 0.0 and stage_factor("nonsense") == 0.0


def test_implementation_pct_is_mean_stage_factor():
    ms = [m("planned"), m("in_progress"), m("evidence_submitted"), m("verified")]
    assert implementation_pct(ms) == pytest.approx(50.0)                # (0 + .25 + .75 + 1) / 4
    assert implementation_pct([m("in_progress")]) == pytest.approx(25.0)
    assert implementation_pct([]) == 0.0


def test_verified_pct_is_share_verified():
    ms = [m("planned"), m("in_progress"), m("evidence_submitted"), m("verified")]
    assert verified_pct(ms) == pytest.approx(25.0)
    assert verified_pct([m("verified"), m("verified")]) == pytest.approx(100.0)
    assert verified_pct([]) == 0.0


def test_cancelled_and_deleted_are_excluded_from_both_percentages():
    base = [m("verified"), m("planned")]
    extra = base + [m("cancelled"), m("deleted"), m("cancelled", 0.9)]
    assert implementation_pct(extra) == implementation_pct(base) == pytest.approx(50.0)
    assert verified_pct(extra) == verified_pct(base) == pytest.approx(50.0)
    assert implementation_pct([m("cancelled")]) == 0.0 and verified_pct([m("deleted")]) == 0.0


def test_credit_only_from_verified_measures():
    assert combined_credit([m("planned", 0.5), m("in_progress", 0.5), m("evidence_submitted", 0.5)]) == 0.0
    assert combined_credit([m("evidence_submitted", 0.5), m("verified", 0.1)]) == pytest.approx(0.1)


def test_projected_credit_tracks_configured_measure_stages():
    assert projected_credit([m("planned", 0.5)]) == 0.0
    assert projected_credit([m("in_progress", 0.4)]) == pytest.approx(0.1)
    assert projected_credit([m("evidence_submitted", 0.4)]) == pytest.approx(0.3)
    assert projected_credit([m("verified", 0.4)]) == pytest.approx(0.4)


def test_projected_credit_combines_multiplicatively_and_respects_cap():
    assert projected_credit([m("in_progress", 0.4), m("evidence_submitted", 0.4)]) == pytest.approx(1 - .9 * .7)
    assert projected_credit([m("verified", 0.5), m("verified", 0.5)]) == pytest.approx(CAP)
    assert projected_credit([m("cancelled", 0.5), m("verified", 0.1)]) == pytest.approx(0.1)
    assert projected_credit([m("verified", 0.0)]) == 0.0


def test_credit_is_multiplicative_not_additive():
    assert combined_credit([m("verified", 0.10), m("verified", 0.20)]) == pytest.approx(1 - 0.9 * 0.8)   # 0.28, not 0.30
    assert combined_credit([m("verified", 0.1)] * 3) == pytest.approx(1 - 0.9 ** 3)


def test_credit_is_capped():
    assert combined_credit([m("verified", 0.5), m("verified", 0.5)]) == pytest.approx(CAP)             # 0.75 -> 0.6
    assert combined_credit([m("verified", 0.5), m("verified", 0.5)], credit_cap=0.7) == pytest.approx(0.7 if 0.75 > 0.7 else 0.75)
    assert combined_credit([m("verified", 0.2)], credit_cap=0.05) == pytest.approx(0.05)


def test_zero_weight_measures_contribute_nothing_and_do_not_break_the_product():
    assert combined_credit([m("verified", 0.0)]) == 0.0
    assert combined_credit([m("verified", 0.0), m("verified", 0.1)]) == pytest.approx(0.1)
    assert combined_credit([]) == 0.0


def test_weights_outside_zero_one_are_clamped():
    assert combined_credit([m("verified", 5.0)]) == pytest.approx(CAP)
    assert combined_credit([m("verified", -1.0)]) == 0.0


def test_cancelled_measures_give_no_credit():
    assert combined_credit([m("cancelled", 0.5), m("verified", 0.1)]) == pytest.approx(0.1)


def test_adjusted_score_exact_and_clamped():
    assert adjusted_score(80.0, 0.25) == pytest.approx(60.0)
    assert adjusted_score(80.0, 0.0) == 80.0 and adjusted_score(80.0, 1.0) == 0.0
    assert adjusted_score(80.0, 1.5) == 0.0                             # credit above 1 cannot go negative
    assert adjusted_score(80.0, -0.5) == 80.0                           # negative credit cannot raise the score
    assert adjusted_score(0.0, 0.5) == 0.0 and adjusted_score(None, 0.5) is None


@pytest.mark.parametrize("base", [0.0, 1.0, 33.3, 100.0])
@pytest.mark.parametrize("credit", [0.0, 0.1, 0.6, 0.99, 1.0])
def test_adjusted_is_between_zero_and_base(base, credit):
    assert 0.0 <= adjusted_score(base, credit) <= base


def test_adjusted_region_index_uses_the_same_mean():
    assert adjusted_region_index([(50.0, 0.0), (100.0, 0.5)]) == pytest.approx(50.0)     # (50 + 50) / 2
    assert adjusted_region_index([(50.0, 0.0), (None, 0.9), (100.0, 0.5)]) == pytest.approx(50.0)
    assert adjusted_region_index([]) is None and adjusted_region_index([(None, 0.2)]) is None
