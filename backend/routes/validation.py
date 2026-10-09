from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DataQuality, YearlyCount
from ..schemas import (MetricsResponse, MonthCount, QualityCheck, ValidationResponse, YearTotal)
from ..services import YOY_JUMP_RATIO, metric_groups

router = APIRouter(prefix="/api", tags=["evidence"])


@router.get("/validation", response_model=ValidationResponse)
def validation(db: Session = Depends(get_db)):
    checks = [QualityCheck(check_name=c.check_name, status=c.status, detail=c.detail)
              for c in db.scalars(select(DataQuality))]
    months = [MonthCount(year=m.year, month=m.month, crashes=m.crashes)
              for m in db.scalars(select(YearlyCount).order_by(YearlyCount.year, YearlyCount.month))]
    by_year: dict[int, list[MonthCount]] = {}
    for m in months:
        by_year.setdefault(m.year, []).append(m)
    totals, prev, last = [], None, max(by_year) if by_year else None
    for y in sorted(by_year):
        tot = sum(m.crashes for m in by_year[y])
        ratio = (tot / prev) if prev else None
        covered = len({m.month for m in by_year[y]})
        totals.append(YearTotal(year=y, crashes=tot, months_covered=covered, partial=(y == last and covered < 12),
                                ratio_vs_previous=ratio, jump=bool(ratio and ratio >= YOY_JUMP_RATIO and y != last)))
        prev = tot
    counts = {s: sum(c.status == s for c in checks) for s in ("PASS", "WARN", "FAIL")}
    return ValidationResponse(counts=counts, checks=checks, yearly_totals=totals, monthly_counts=months)


@router.get("/metrics", response_model=MetricsResponse)
def metrics(db: Session = Depends(get_db)):
    g = metric_groups(db)
    rob = [g[k] for k in sorted(g) if k.startswith("robustness_")]
    sec = [g[k] for k in ("second_split_overall", "second_split_low_history") if k in g]
    boot = g["bootstrap_low_history"].extra if "bootstrap_low_history" in g else None
    return MetricsResponse(overall=g.get("overall"), low_history=g.get("low_history"), robustness=rob,
                           second_split=sec, bootstrap=boot,
                           caveat="One city, indicative, not proof. Few low-history cells became blackspots, "
                                  "so intervals are wide.")
