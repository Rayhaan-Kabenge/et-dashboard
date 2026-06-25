"""FastAPI app: health, /api/state (cached), /api/validate-sheet.

The state endpoint loads the sheet, runs the engine, and returns the full
dashboard payload. Results are cached briefly per sheet id; ?refresh=1 bypasses.
"""
from __future__ import annotations

import time
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import schemas
from .compute import build_state
from .config import get_settings
from .sheets import SheetValidationError, make_source

app = FastAPI(
    title="ET Irrigation-Decision Dashboard API",
    version="1.0.0",
    description="I/O + orchestration around the validated et_engine package.",
)

settings = get_settings()

origins = [o.strip() for o in settings.frontend_origin.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---- tiny in-process TTL cache (per sheet id) ------------------------------
_CACHE: dict[str, tuple[float, schemas.StateResponse]] = {}


def _cache_key() -> str:
    return settings.sheet_id or "demo"


@app.get("/api/health")
def health():
    return {"status": "ok", "demo_mode": settings.demo_mode, "version": app.version}


@app.get("/api/state", response_model=schemas.StateResponse)
def state(refresh: int = Query(0, description="set 1 to bypass cache")):
    key = _cache_key()
    now = time.time()
    if not refresh and key in _CACHE:
        ts, payload = _CACHE[key]
        if now - ts < settings.cache_ttl_seconds:
            return payload
    try:
        payload = build_state(settings)
    except SheetValidationError as exc:
        raise HTTPException(status_code=422, detail={
            "message": "sheet failed validation",
            "errors": [{"tab": e.tab, "field": e.field, "message": e.message} for e in exc.errors],
        })
    except Exception as exc:  # pragma: no cover - surface unexpected failures
        raise HTTPException(status_code=500, detail=f"failed to build state: {exc}")
    _CACHE[key] = (now, payload)
    return payload


@app.post("/api/validate-sheet", response_model=schemas.ValidateResponse)
def validate_sheet():
    """Structurally validate the configured sheet (v1.5 hook; works in v1 too)."""
    try:
        inputs = make_source(settings).load()
    except SheetValidationError as exc:
        return schemas.ValidateResponse(
            ok=False,
            errors=[schemas.FieldError(tab=e.tab, field=e.field, message=e.message)
                    for e in exc.errors])
    return schemas.ValidateResponse(ok=True, warnings=inputs.warnings)
