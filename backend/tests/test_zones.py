"""Slice 4a — unified Field↔Zone geometry: migration, drawing, area-from-polygon.

No engine, no network. Confirms zones are named management units (name+boundary),
same-crop zones coexist, areas come from polygons, and zones still work with no
geometry.
"""
from __future__ import annotations

import pytest

from app.config import get_settings, resolve_crop
from app.farm import store


@pytest.fixture
def tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "STORE", tmp_path / "farm.json")
    return tmp_path / "farm.json"


# --- migration --------------------------------------------------------------
def test_seed_gives_field_boundary_and_named_zone_geometries(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)
    field = store.get_field(store.SEED_FIELD_ID)
    assert field.boundary is not None and field.area_acres and field.area_acres > 0

    corn = next(z for z in field.zones if z.crop == "corn")
    sorg = next(z for z in field.zones if z.crop == "sorghum")
    assert corn.name == "Corn block" and sorg.name == "Sorghum block"      # block names
    assert corn.boundary is not None and sorg.boundary is not None         # geometries
    assert corn.area_acres and sorg.area_acres                             # areas from polygons
    # zones still carry their own engine sheet (unchanged from Slice 1)
    assert corn.sheet_id == resolve_crop("corn", s)
    assert sorg.sheet_id == resolve_crop("sorghum", s)


def test_backfill_geometry_onto_pre_4a_store(tmp_store):
    # simulate a Slice-1 store: Colby with zones but NO geometry
    import json
    pre = {
        "active_field_id": store.SEED_FIELD_ID,
        "fields": {store.SEED_FIELD_ID: {
            "id": store.SEED_FIELD_ID, "name": "Colby 2026", "boundary": None, "area_acres": None,
            "meter": {"readings": [{"date": "2026-06-01", "meter_reading": 1, "unit": "gallons"}]},
            "zones": [
                {"id": "zone-corn-2026", "name": "Corn", "crop": "corn", "sheet_id": "CORN", "boundary": None},
                {"id": "zone-sorghum-2026", "name": "Sorghum", "crop": "sorghum", "sheet_id": "SORG", "boundary": None},
            ],
        }},
    }
    tmp_store.write_text(json.dumps(pre), encoding="utf-8")

    store.ensure_seeded(get_settings())
    field = store.get_field(store.SEED_FIELD_ID)
    assert field.boundary is not None                       # backfilled
    assert all(z.boundary is not None for z in field.zones) # backfilled
    assert {z.name for z in field.zones} == {"Corn block", "Sorghum block"}
    # never clobbers existing data: sheet_ids and the meter survive
    assert next(z for z in field.zones if z.crop == "corn").sheet_id == "CORN"
    assert store.get_meter(store.SEED_FIELD_ID)["readings"]


# --- named management units -------------------------------------------------
def test_two_same_crop_zones_are_distinct(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)
    ring = [[-101.07, 39.38], [-101.068, 39.38], [-101.068, 39.382], [-101.07, 39.382], [-101.07, 39.38]]
    field = store.add_zone(store.SEED_FIELD_ID, name="North corn", crop="corn",
                           sheet_id=resolve_crop("corn", s), boundary={"type": "Polygon", "coordinates": [ring]})
    corn_zones = [z for z in field.zones if z.crop == "corn"]
    assert len(corn_zones) == 2                              # two corn zones
    assert {z.name for z in corn_zones} == {"Corn block", "North corn"}
    assert all(z.id for z in corn_zones)                     # distinct ids
    north = next(z for z in corn_zones if z.name == "North corn")
    assert north.area_acres and north.area_acres > 0         # area from polygon


def test_zone_without_geometry_still_functions(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)
    field = store.add_zone(store.SEED_FIELD_ID, name="Planned block", crop="sorghum",
                           sheet_id=resolve_crop("sorghum", s), boundary=None)
    z = next(z for z in field.zones if z.name == "Planned block")
    assert z.boundary is None and z.area_acres is None       # no geometry
    assert z.sheet_id == resolve_crop("sorghum", s)          # window/engine run still works


# --- edits ------------------------------------------------------------------
def test_update_zone_rename_recrop_redraw(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)
    zid = "zone-corn-2026"
    ring = [[-101.071, 39.379], [-101.066, 39.379], [-101.066, 39.386], [-101.071, 39.386], [-101.071, 39.379]]
    field = store.update_zone(store.SEED_FIELD_ID, zid, name="Renamed block",
                              boundary={"type": "Polygon", "coordinates": [ring]})
    z = next(z for z in field.zones if z.id == zid)
    assert z.name == "Renamed block"
    assert z.area_acres and z.area_acres > 0


def test_delete_zone_guards_last_zone(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)
    _, status = store.delete_zone(store.SEED_FIELD_ID, "zone-sorghum-2026")
    assert status == "ok"
    # only the corn zone remains — deleting it must be refused
    field, status = store.delete_zone(store.SEED_FIELD_ID, "zone-corn-2026")
    assert status == "last"
    assert len(store.get_field(store.SEED_FIELD_ID).zones) == 1


def test_set_field_boundary_recomputes_area(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)
    ring = [[-101.08, 39.37], [-101.05, 39.37], [-101.05, 39.40], [-101.08, 39.40], [-101.08, 39.37]]
    field = store.set_field_boundary(store.SEED_FIELD_ID, {"type": "Polygon", "coordinates": [ring]})
    assert field.area_acres and field.area_acres > 100       # a big rectangle
