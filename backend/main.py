"""WAYMARK API. Run from the project root:  uvicorn backend.main:app --reload   (docs at /docs)"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings
from .config_loader import get_effects
from .db import DB_PATH, engine
from .models_ops import create_ops_tables
from .routes import (audit, auth, cells, chat, crashes, evidence, measures, places, regions, reports, system,
                     validation, whatif)

log = logging.getLogger("waymark")


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_effects()                                  # refuse to start on a malformed effects.json
    if DB_PATH.exists():                           # never let SQLite create an empty database by accident
        create_ops_tables(engine)                  # new tables only; existing tables are left alone
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="WAYMARK API", version="2.0.0", lifespan=lifespan,
              description="Explainable road risk, cell by cell, plus the action loop: region reports, an assistant, "
                          "tracked measures with photo evidence and a verified-only adjusted risk estimate. "
                          "Decision support only; human experts decide.")

app.add_middleware(GZipMiddleware, minimum_size=1000)   # the full cell list is ~1.6 MB of JSON
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                   allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
                   allow_headers=["Authorization", "Content-Type"])

for r in (system.router, cells.router, crashes.router, places.router, whatif.router, validation.router, audit.router,
          auth.router, regions.router, reports.router, measures.router, evidence.router, chat.router):
    app.include_router(r)


@app.exception_handler(Exception)
async def unexpected(_: Request, exc: Exception):
    # Never leak internals; the frontend shows the message in an error banner.
    log.exception("unhandled error")
    return JSONResponse(status_code=500, content={"detail": "Unexpected server error. Please try again."})


class SPAStaticFiles(StaticFiles):
    """Serve the built frontend; unknown paths (such as /region/abc on a page reload) get index.html."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code == 404 and not path.startswith("api/"):
                return await super().get_response("index.html", scope)
            raise


# Optional: serve the built frontend (frontend/dist) from the same server for one-command deployment.
DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/", SPAStaticFiles(directory=DIST, html=True), name="frontend")
