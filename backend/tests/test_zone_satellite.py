"""Zone-level satellite target adapter — boundary selection + per-zone cache key.

No network / no Sentinel here: this covers the ONLY new logic (which boundary the
analysis runs over, and that the cache id is namespaced per zone + geometry). The
NDRE/NDVI/SI math is unchanged and exercised elsewhere / live.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.farm import store as farm_store
from app.farm.schemas import ZoneCreate
from app.field import field_api


def _poly(ring):
    return {"type": "Polygon", "coordinates": [ring]}


FIELD_RING = [[-101.07, 39.38], [-101.05, 39.38], [-101.05, 39.40], [-101.07, 39.40], [-101.07, 39.38]]
ZONE_RING = [[-101.07, 39.38], [-101.06, 39.38], [-101.06, 39.39], [-101.07, 39.39], [-101.07, 39.38]]


@pytest.fixture
def farm(tmp_path, monkeypatch):
    monkeypatch.setattr(farm_store, "STORE", tmp_path / "farm.json")
    f = farm_store.create_field(
        "F", [ZoneCreate(name="Drawn", crop="corn", sheet_id="S", boundary=_poly(ZONE_RING))],
        boundary=_poly(FIELD_RING),
    )
    # a second zone with NO boundary (planned but not drawn)
    f = farm_store.add_zone(f.id, name="Undrawn", crop="sorghum", sheet_id="S2", boundary=None)
    drawn = next(z for z in f.zones if z.name == "Drawn")
    undrawn = next(z for z in f.zones if z.name == "Undrawn")
    return f, drawn, undrawn


def test_drawn_zone_runs_over_its_own_boundary(farm):
    _f, drawn, _u = farm
    target, note = field_api._zone_target(drawn.id)
    assert note is None
    assert target.geometry == _poly(ZONE_RING)          # the ZONE boundary, not the field
    assert target.id.startswith(f"zone-{drawn.id}-")    # per-zone cache namespace
    assert target.crop == "corn" and target.name == "Drawn"


def test_no_boundary_zone_falls_back_to_field_with_note(farm):
    _f, _d, undrawn = farm
    target, note = field_api._zone_target(undrawn.id)
    assert target.geometry == _poly(FIELD_RING)         # graceful: whole-field boundary
    assert note and "draw this zone" in note.lower()


def test_cache_id_is_per_zone_and_per_boundary(farm):
    f, drawn, _u = farm
    id1 = field_api._zone_target(drawn.id)[0].id
    # redraw the zone's boundary → the cache id must change (no stale/poisoned grid)
    farm_store.update_zone(f.id, drawn.id, boundary=_poly(FIELD_RING))
    id2 = field_api._zone_target(drawn.id)[0].id
    assert id1 != id2
    assert id1.startswith(f"zone-{drawn.id}-") and id2.startswith(f"zone-{drawn.id}-")


def test_missing_zone_404(farm):
    with pytest.raises(HTTPException) as exc:
        field_api._zone_target("nope")
    assert exc.value.status_code == 404
