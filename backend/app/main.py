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
from .config import available_crops, get_settings, resolve_crop
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

# ---- tiny in-process TTL cache (keyed per resolved sheet id) ---------------
_CACHE: dict[str, tuple[float, schemas.StateResponse]] = {}


def _cache_key(sheet_id: Optional[str]) -> str:
    return sheet_id or "demo"


@app.get("/api/health")
def health():
    return {"status": "ok", "demo_mode": settings.demo_mode, "version": app.version}


@app.get("/api/crops")
def crops():
    """Registered crops the toggle may offer (allow-list). Ids map to sheets
    server-side via resolve_crop — the frontend never sees a sheet id."""
    return available_crops(settings)


@app.get("/api/state", response_model=schemas.StateResponse)
def state(refresh: int = Query(0, description="set 1 to bypass cache"),
          crop: Optional[str] = Query(None, description="crop key (corn|sorghum); default corn")):
    # Resolve crop → sheet id via the allow-list. The default crop reuses the
    # process settings verbatim (byte-identical to the pre-toggle behavior);
    # any other crop gets a per-request Settings with that sheet id.
    sheet_id = resolve_crop(crop, settings)
    use_settings = settings if sheet_id == resolve_crop(None, settings) \
        else settings.model_copy(update={"sheet_id": sheet_id})
    key = _cache_key(sheet_id)
    now = time.time()
    if not refresh and key in _CACHE:
        ts, payload = _CACHE[key]
        if now - ts < settings.cache_ttl_seconds:
            return payload
    try:
        payload = build_state(use_settings)
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


# --- Field Health module (isolated; mounted ONLY when the flag is on) --------
# The import lives inside the guard so app/field is never loaded when off, keeping
# the engine build completely decoupled from this feature.
if settings.feature_field_health:
    from .field.field_api import router as field_router

    app.include_router(field_router)
