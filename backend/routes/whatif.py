from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Cell, CellScenario
from ..schemas import SCENARIO_LABEL, WhatIfItem, WhatIfResponse

router = APIRouter(prefix="/api", tags=["what-if"])


@router.get("/whatif", response_model=WhatIfResponse)
def whatif(night: bool = False, rain: bool = False, low_vis: bool = False, db: Session = Depends(get_db)):
    """Baseline vs scenario probability for every cell. A factor that is off keeps the recorded values."""
    q = (select(Cell.cell_id, Cell.baseline_prob, CellScenario.probability, Cell.emerging_risk)
         .join(CellScenario, CellScenario.cell_id == Cell.cell_id)
         .where(CellScenario.night == int(night), CellScenario.rain == int(rain),
                CellScenario.low_vis == int(low_vis)))
    items = [WhatIfItem(cell_id=cid, baseline=b, scenario=s, change=s - b, emerging_risk=bool(e))
             for cid, b, s, e in db.execute(q) if b is not None]
    em = [i.change for i in items if i.emerging_risk]
    mean = lambda xs: (sum(xs) / len(xs)) if xs else None
    return WhatIfResponse(
        label=SCENARIO_LABEL, night=night, rain=rain, low_vis=low_vis, n_cells=len(items), n_emerging=len(em),
        mean_change_all=mean([i.change for i in items]), mean_change_emerging=mean(em),
        share_cells_higher=(sum(i.change > 0 for i in items) / len(items)) if items else None, items=items)
