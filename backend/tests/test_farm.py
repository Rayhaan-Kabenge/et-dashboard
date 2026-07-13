"""Field→Zone model, store, migration, and byte-identical sheet resolution.

No engine run and no network here: the safety gate is that the NEW zone/field
selector resolves to the SAME sheet id as the legacy `resolve_crop()`. Same sheet
id → same `build_state()` input → byte-identical engine output. The end-to-end
identical-payload check is done live against the running server.
"""
from __future__ import annotations

import pytest

from app.config import DEFAULT_CROP, get_settings, resolve_crop
from app.farm import resolve, store
from app.farm.schemas import Field, ZoneCreate


@pytest.fixture
def tmp_store(tmp_path, monkeypatch):
    """Point the farm store at a throwaway file so tests never touch real data."""
    monkeypatch.setattr(store, "STORE", tmp_path / "farm.json")
    return tmp_path / "farm.json"


# --- migration / seed -------------------------------------------------------
def test_seed_creates_one_field_with_corn_and_sorghum_zones(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)

    fields = store.list_fields()
    assert len(fields) == 1
    f = fields[0]
    assert f.name == "Colby 2026"
    assert len(f.zones) == 2                                # a split field: two zones
    assert {z.crop for z in f.zones} == {"corn", "sorghum"}

    corn = store.find_zone_by_crop("corn")
    sorg = store.find_zone_by_crop("sorghum")
    # each zone owns its sheet_id, seeded from the legacy registry
    assert corn.sheet_id == resolve_crop("corn", s)
    assert sorg.sheet_id == resolve_crop("sorghum", s)
    assert corn.season_year == 2026                          # multi-year-ready
    assert store.active_field_id() == f.id                   # one field selectable/active


def test_seed_is_idempotent_and_never_clobbers(tmp_store):
    store.ensure_seeded()
    first = store.list_fields()[0].id
    store.ensure_seeded()                                     # second call is a no-op
    fields = store.list_fields()
    assert len(fields) == 1 and fields[0].id == first


# --- byte-identical safety gate --------------------------------------------
def test_zone_and_crop_alias_resolve_identically_to_legacy(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)
    corn = store.find_zone_by_crop("corn")
    sorg = store.find_zone_by_crop("sorghum")

    # zone_id (new primary path) == legacy resolve_crop → identical engine input
    assert resolve.resolve_sheet(zone_id=corn.id, settings=s) == resolve_crop("corn", s)
    assert resolve.resolve_sheet(zone_id=sorg.id, settings=s) == resolve_crop("sorghum", s)

    # ?crop= alias resolves to the corresponding migrated zone
    assert resolve.resolve_sheet(crop="corn", settings=s) == resolve_crop("corn", s)
    assert resolve.resolve_sheet(crop="sorghum", settings=s) == resolve_crop("sorghum", s)

    # the two selectors agree with each other for the same crop
    assert (resolve.resolve_sheet(zone_id=corn.id, settings=s)
            == resolve.resolve_sheet(crop="corn", settings=s))


def test_default_selection_matches_legacy_default(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)
    assert resolve.resolve_sheet(settings=s) == resolve_crop(None, s)


def test_unknown_selection_degrades_to_default_never_arbitrary(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)
    assert resolve.resolve_sheet(zone_id="does-not-exist", settings=s) == resolve_crop(None, s)
    assert resolve.resolve_sheet(crop="rice", settings=s) == resolve_crop(None, s)


# --- structural invariants --------------------------------------------------
def test_field_must_have_at_least_one_zone():
    with pytest.raises(Exception):
        Field(id="x", name="No zones", zones=[])


def test_single_crop_field_is_the_trivial_one_zone_case(tmp_store):
    f = store.create_field("North Pivot", [ZoneCreate(name="Corn", crop="corn", sheet_id="SHEET_A")])
    assert len(f.zones) == 1 and f.zones[0].crop == "corn"


def test_multiple_fields_supported(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)                                    # field 1: Colby (2 zones)
    store.create_field("East Pivot", [ZoneCreate(name="Corn", crop="corn", sheet_id="SHEET_B")])
    assert len(store.list_fields()) == 2                      # two pivots


def test_zone_lookup_can_be_scoped_to_a_field(tmp_store):
    s = get_settings()
    store.ensure_seeded(s)
    other = store.create_field("Other", [ZoneCreate(name="Sorghum", crop="sorghum", sheet_id="SHEET_C")])
    # scoped to the new field, "sorghum" resolves to that field's sheet, not Colby's
    assert resolve.resolve_sheet(crop="sorghum", field_id=other.id, settings=s) == "SHEET_C"
