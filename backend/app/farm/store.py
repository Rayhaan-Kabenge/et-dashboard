"""JSON-backed persistence for the engine-side Field→Zone model.

Same pattern as the Field-Health field store: a single JSON file under
backend/data/ (gitignored), a process lock, atomic writes. Separate file
(farm.json) and separate concept — this holds engine run-selection state
(fields, their zones, the active-field pointer), not satellite polygons.

Migration: `ensure_seeded()` promotes the current setup exactly once — it reads
the existing config crop registry (corn/sorghum → sheet_id) and materializes ONE
Field ("Colby 2026") with TWO zones (a corn zone + a sorghum zone), each carrying
its own sheet_id. The registry is the SEED; from here on zones own the sheet_id.
"""
from __future__ import annotations

import json
import threading
import uuid
from pathlib import Path
from typing import Iterable, Optional

from ..config import CROP_LABELS, Settings, _crop_registry, get_settings
# Reuse the field-health geometry helpers (pure math — no engine/satellite deps).
from ..field.geometry import area_acres as poly_area_acres
from .schemas import Field, Zone, ZoneCreate

DATA_DIR = Path(__file__).resolve().parents[2] / "data"   # backend/data
STORE = DATA_DIR / "farm.json"                            # tests may monkeypatch this

_lock = threading.RLock()

SEED_FIELD_ID = "field-colby-2026"
SEED_SEASON_YEAR = 2026
SEED_FIELD_NAME = "Colby 2026"


def _poly(ring: list[list[float]]) -> dict:
    return {"type": "Polygon", "coordinates": [ring]}


# Migration geometry — a split field near Colby, KS: whole outline + a west
# "Corn block" half and an east "Sorghum block" half (mirrors the real split
# field). Placeholder polygons a grower re-draws on the map; the point is the
# unified model (drawn zones == engine zones).
_SEED_FIELD_BOUNDARY = _poly(
    [[-101.072, 39.379], [-101.058, 39.379], [-101.058, 39.389], [-101.072, 39.389], [-101.072, 39.379]])
_SEED_ZONE_GEOM = {
    "corn": {"name": "Corn block",
             "boundary": _poly([[-101.072, 39.379], [-101.065, 39.379], [-101.065, 39.389],
                                [-101.072, 39.389], [-101.072, 39.379]])},
    "sorghum": {"name": "Sorghum block",
                "boundary": _poly([[-101.065, 39.379], [-101.058, 39.379], [-101.058, 39.389],
                                   [-101.065, 39.389], [-101.065, 39.379]])},
}


def _area(geometry: Optional[dict]) -> Optional[float]:
    """Acres from a polygon, or None if absent/invalid."""
    if not geometry:
        return None
    try:
        return round(poly_area_acres(geometry), 2)
    except Exception:
        return None


def _empty() -> dict:
    return {"active_field_id": None, "fields": {}}


def _load_raw() -> dict:
    if not STORE.exists():
        return _empty()
    try:
        return json.loads(STORE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return _empty()


def _save_raw(data: dict) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(STORE)


def _gen_id() -> str:
    return uuid.uuid4().hex[:12]


# --------------------------------------------------------------------------- #
# migration / seed
# --------------------------------------------------------------------------- #
def _seed_zone(crop: str, sheet_id: str) -> Zone:
    geom = _SEED_ZONE_GEOM.get(crop, {})
    boundary = geom.get("boundary")
    return Zone(
        id=f"zone-{crop}-{SEED_SEASON_YEAR}",
        name=geom.get("name") or CROP_LABELS.get(crop, crop.title()),
        crop=crop, sheet_id=sheet_id, season_year=SEED_SEASON_YEAR,
        boundary=boundary, area_acres=_area(boundary),
    )


def ensure_seeded(settings: Optional[Settings] = None) -> None:
    """Migrate the current setup: one Field ("Colby 2026") with a corn + sorghum
    management zone, each seeded from the crop registry AND given a drawn boundary
    + block name (Slice 4a). Seeds once for an empty store; for a store from an
    earlier slice it BACKFILLS the field/zone geometry idempotently, never
    clobbering meter data or user-drawn boundaries."""
    with _lock:
        s = settings or get_settings()
        data = _load_raw()

        if not data.get("fields"):
            zones = [_seed_zone(crop, sheet_id) for crop, sheet_id in _crop_registry(s).items()]
            field = Field(id=SEED_FIELD_ID, name=SEED_FIELD_NAME,
                          boundary=_SEED_FIELD_BOUNDARY, area_acres=_area(_SEED_FIELD_BOUNDARY),
                          zones=zones)
            _save_raw({"active_field_id": field.id, "fields": {field.id: field.model_dump()}})
            return

        # backfill geometry onto the pre-4a seed field, if still missing
        raw = data["fields"].get(SEED_FIELD_ID)
        if raw is None:
            return
        changed = False
        if not raw.get("boundary"):
            raw["boundary"] = _SEED_FIELD_BOUNDARY
            raw["area_acres"] = _area(_SEED_FIELD_BOUNDARY)
            changed = True
        for z in raw.get("zones", []):
            spec = _SEED_ZONE_GEOM.get((z.get("crop") or "").lower())
            if spec and not z.get("boundary"):
                z["boundary"] = spec["boundary"]
                z["area_acres"] = _area(spec["boundary"])
                # only adopt the block name if the zone still has the old crop-label default
                if z.get("name") in (CROP_LABELS.get(z.get("crop")), (z.get("crop") or "").title()):
                    z["name"] = spec["name"]
                changed = True
        if changed:
            _save_raw(data)


# --------------------------------------------------------------------------- #
# reads
# --------------------------------------------------------------------------- #
def list_fields() -> list[Field]:
    return [Field(**f) for f in _load_raw()["fields"].values()]


def get_field(field_id: str) -> Optional[Field]:
    raw = _load_raw()["fields"].get(field_id)
    return Field(**raw) if raw else None


def active_field_id() -> Optional[str]:
    return _load_raw().get("active_field_id")


def get_active_field() -> Optional[Field]:
    data = _load_raw()
    fid = data.get("active_field_id")
    raw = data["fields"].get(fid) if fid else None
    if raw is None:  # pointer missing/stale — fall back to the first field, if any
        vals = list(data["fields"].values())
        raw = vals[0] if vals else None
    return Field(**raw) if raw else None


def _fields_in_search_order(data: dict, field_id: Optional[str]) -> Iterable[dict]:
    """A specific field if given, else the active field first, then the rest."""
    fields = data["fields"]
    if field_id and field_id in fields:
        return [fields[field_id]]
    active = data.get("active_field_id")
    order: list[dict] = []
    if active and active in fields:
        order.append(fields[active])
    order += [f for fid, f in fields.items() if fid != active]
    return order


def get_zone(zone_id: str, field_id: Optional[str] = None) -> Optional[Zone]:
    data = _load_raw()
    for f in _fields_in_search_order(data, field_id):
        for z in f.get("zones", []):
            if z.get("id") == zone_id:
                return Zone(**z)
    return None


def get_field_of_zone(zone_id: str) -> Optional[Field]:
    """The Field that contains a given zone (used to fall back to the field
    boundary for zone-level satellite when a zone has no drawn boundary yet)."""
    data = _load_raw()
    for f in data["fields"].values():
        if any(z.get("id") == zone_id for z in f.get("zones", [])):
            return Field(**f)
    return None


def find_zone_by_crop(crop: str, field_id: Optional[str] = None) -> Optional[Zone]:
    key = (crop or "").strip().lower()
    if not key:
        return None
    data = _load_raw()
    for f in _fields_in_search_order(data, field_id):
        for z in f.get("zones", []):
            if (z.get("crop") or "").strip().lower() == key:
                return Zone(**z)
    return None


# --------------------------------------------------------------------------- #
# writes
# --------------------------------------------------------------------------- #
def set_active_field(field_id: str) -> Optional[Field]:
    with _lock:
        data = _load_raw()
        if field_id not in data["fields"]:
            return None
        data["active_field_id"] = field_id
        _save_raw(data)
        return Field(**data["fields"][field_id])


def create_field(name: str, zones: list[ZoneCreate], *, boundary: Optional[dict] = None,
                 area_acres: Optional[float] = None, meter: Optional[dict] = None,
                 make_active: bool = True) -> Field:
    """Create a Field with >= 1 zone (each zone gets a generated id). Supports the
    multi-field case (several pivots)."""
    field = Field(
        id=_gen_id(), name=name.strip() or "Field", boundary=boundary,
        area_acres=area_acres, meter=meter,
        zones=[Zone(id=_gen_id(), name=z.name, crop=z.crop, sheet_id=z.sheet_id,
                    season_year=z.season_year, boundary=z.boundary, area_acres=z.area_acres)
               for z in zones],
    )
    with _lock:
        data = _load_raw()
        data["fields"][field.id] = field.model_dump()
        if make_active or data.get("active_field_id") is None:
            data["active_field_id"] = field.id
        _save_raw(data)
    return field


# --------------------------------------------------------------------------- #
# geometry + zones (Slice 4a — drawn boundaries wire onto the engine zones)
# --------------------------------------------------------------------------- #
def set_field_boundary(field_id: str, geometry: dict) -> Optional[Field]:
    """Set/replace the field's outline; recompute its acreage from the polygon."""
    with _lock:
        data = _load_raw()
        raw = data["fields"].get(field_id)
        if raw is None:
            return None
        raw["boundary"] = geometry
        raw["area_acres"] = _area(geometry)
        _save_raw(data)
        return Field(**raw)


def add_zone(field_id: str, *, name: str, crop: str, sheet_id: str,
             boundary: Optional[dict] = None, season_year: Optional[int] = SEED_SEASON_YEAR) -> Optional[Field]:
    """Append a management zone (its own name/crop/sheet/boundary). Two zones may
    share a crop — identity is the name+boundary, so no crop-uniqueness check."""
    with _lock:
        data = _load_raw()
        raw = data["fields"].get(field_id)
        if raw is None:
            return None
        zone = Zone(id=_gen_id(), name=name.strip() or crop.title(), crop=crop,
                    sheet_id=sheet_id, season_year=season_year,
                    boundary=boundary, area_acres=_area(boundary))
        raw.setdefault("zones", []).append(zone.model_dump())
        _save_raw(data)
        return Field(**raw)


def update_zone(field_id: str, zone_id: str, *, name: Optional[str] = None,
                crop: Optional[str] = None, sheet_id: Optional[str] = None,
                boundary: Optional[dict] = None) -> Optional[Field]:
    """Patch a zone in place — rename, re-crop (pass the new sheet_id too), or
    (re)draw its boundary (recomputes area). Omitted fields stay unchanged."""
    with _lock:
        data = _load_raw()
        raw = data["fields"].get(field_id)
        if raw is None:
            return None
        for z in raw.get("zones", []):
            if z.get("id") == zone_id:
                if name is not None:
                    z["name"] = name.strip() or z["name"]
                if crop is not None:
                    z["crop"] = crop
                if sheet_id is not None:
                    z["sheet_id"] = sheet_id
                if boundary is not None:
                    z["boundary"] = boundary
                    z["area_acres"] = _area(boundary)
                _save_raw(data)
                return Field(**raw)
        return None


def delete_zone(field_id: str, zone_id: str) -> tuple[Optional[Field], str]:
    """Remove a zone. Refuses to delete the last one (a Field always has >= 1
    zone). Returns (field, status) where status is 'ok' | 'not_found' | 'last'."""
    with _lock:
        data = _load_raw()
        raw = data["fields"].get(field_id)
        if raw is None:
            return None, "not_found"
        zones = raw.get("zones", [])
        if not any(z.get("id") == zone_id for z in zones):
            return None, "not_found"
        if len(zones) <= 1:
            return Field(**raw), "last"
        raw["zones"] = [z for z in zones if z.get("id") != zone_id]
        _save_raw(data)
        return Field(**raw), "ok"


# --------------------------------------------------------------------------- #
# field meter (optional, field-level — additive; never affects zone selection)
# --------------------------------------------------------------------------- #
def get_meter(field_id: str) -> Optional[dict]:
    """The field's flow-meter log (readings + area basis). Returns an empty meter
    for a known field with none yet, or None if the field doesn't exist."""
    raw = _load_raw()["fields"].get(field_id)
    if raw is None:
        return None
    return raw.get("meter") or {"readings": [], "area_basis": "field", "area_override": None}


def set_meter(field_id: str, meter: dict) -> bool:
    """Persist the meter on the Field object. Returns False if the field is absent."""
    with _lock:
        data = _load_raw()
        if field_id not in data["fields"]:
            return False
        data["fields"][field_id]["meter"] = meter
        _save_raw(data)
        return True
