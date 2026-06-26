"""App-side persistence for fields + the active-field pointer.

Single JSON file under backend/data/fields.json (gitignored). Simple and ample
for this scale. Swap for SQLite later without changing callers.
"""
from __future__ import annotations

import json
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .geometry import area_acres, bbox, centroid
from .schemas import Field

DATA_DIR = Path(__file__).resolve().parents[2] / "data"   # backend/data
STORE = DATA_DIR / "fields.json"
CACHE_DIR = DATA_DIR / "cache"

_lock = threading.Lock()


def _ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _load_raw() -> dict:
    if not STORE.exists():
        return {"active_id": None, "fields": {}}
    try:
        return json.loads(STORE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"active_id": None, "fields": {}}


def _save_raw(data: dict) -> None:
    _ensure_dirs()
    tmp = STORE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(STORE)


def build_field(name: str, geometry: dict, crop: Optional[str] = None) -> Field:
    """Compute derived geometry and return a Field (not yet persisted)."""
    return Field(
        id=uuid.uuid4().hex[:12],
        name=name.strip() or "Field",
        geometry=geometry,
        centroid=[round(c, 6) for c in centroid(geometry)],
        bbox=[round(b, 6) for b in bbox(geometry)],
        area_acres=round(area_acres(geometry), 2),
        crop=crop,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def create_field(name: str, geometry: dict, crop: Optional[str] = None) -> Field:
    field = build_field(name, geometry, crop)
    with _lock:
        data = _load_raw()
        data["fields"][field.id] = field.model_dump()
        data["active_id"] = field.id          # newly created field becomes active
        _save_raw(data)
    return field


def get_field(field_id: str) -> Optional[Field]:
    raw = _load_raw()["fields"].get(field_id)
    return Field(**raw) if raw else None


def get_active() -> Optional[Field]:
    data = _load_raw()
    aid = data.get("active_id")
    raw = data["fields"].get(aid) if aid else None
    return Field(**raw) if raw else None


def set_active(field_id: str) -> Optional[Field]:
    with _lock:
        data = _load_raw()
        if field_id not in data["fields"]:
            return None
        data["active_id"] = field_id
        _save_raw(data)
        return Field(**data["fields"][field_id])


def list_fields() -> list[Field]:
    return [Field(**f) for f in _load_raw()["fields"].values()]


def delete_field(field_id: str) -> bool:
    """Remove a field from the store, clear the active pointer if it pointed here,
    and delete that field's cached index/image/et/summary entries. Returns True if
    the field existed."""
    with _lock:
        data = _load_raw()
        existed = field_id in data["fields"]
        data["fields"].pop(field_id, None)
        if data.get("active_id") == field_id:
            data["active_id"] = None
        _save_raw(data)
    cache_dir = CACHE_DIR / field_id
    if cache_dir.exists():
        shutil.rmtree(cache_dir, ignore_errors=True)
    return existed


def cache_path(field_id: str, *parts: str) -> Path:
    _ensure_dirs()
    d = CACHE_DIR / field_id
    d.mkdir(parents=True, exist_ok=True)
    return d.joinpath(*parts)
