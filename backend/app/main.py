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
from .farm import store as farm_store
from .farm.api import router as farm_router
from .farm.resolve import resolve_sheet
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
    # The farm API uses PUT (field boundary / zone edit / meter) and DELETE
    # (remove a zone) in addition to GET/POST. Without these, the browser's CORS
    # preflight rejects those cross-origin calls ("failed to fetch").
    allow_methods=["GET", "POST", "PUT", "DELETE"],
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
          crop: Optional[str] = Query(None, description="crop key (corn|sorghum) — alias for the matching zone"),
          zone_id: Optional[str] = Query(None, description="zone id whose sheet drives this run (primary selector)"),
          field_id: Optional[str] = Query(None, description="optional field scope for the crop/zone lookup")):
    # Resolve the run selection → sheet id via the Field→Zone model (zone_id is
    # primary; ?crop= is a backwards-compatible alias for the matching zone).
    # This only chooses WHICH sheet feeds the engine — build_state is unchanged.
    # The default selection reuses the process settings verbatim (byte-identical
    # to the pre-refactor behavior); any other sheet gets a per-request copy.
    sheet_id = resolve_sheet(zone_id=zone_id, crop=crop, field_id=field_id, settings=settings)
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


# --- Field→Zone model (engine-side run selection) ---------------------------
# Always mounted. Seed the store (one field, corn+sorghum zones) at startup so
# the migration is in place before the first request; ensure_seeded is a no-op
# once fields exist.
app.include_router(farm_router)
farm_store.ensure_seeded(settings)


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
