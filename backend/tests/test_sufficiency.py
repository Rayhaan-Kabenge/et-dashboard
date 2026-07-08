"""Unit tests for the Sufficiency-Index math + zoning (synthetic grids, no network)."""
from __future__ import annotations

import io
import json
import zipfile
from datetime import date, timedelta

import numpy as np
import pytest

from app.field import sufficiency as sfy
from app.field.schemas import Field


def _field() -> Field:
    # 0.01° x 0.01° square near North Platte (well inside coverage)
    ring = [[-101.10, 39.37], [-101.09, 39.37], [-101.09, 39.38], [-101.10, 39.38], [-101.10, 39.37]]
    return Field(id="test123", name="Test", geometry={"type": "Polygon", "coordinates": [ring]},
                 centroid=[-101.095, 39.375], bbox=[-101.10, 39.37, -101.09, 39.38],
                 area_acres=100.0, crop="Corn", created_at="2026-01-01T00:00:00Z")


def _grid(shape=(20, 20), lo=0.30, hi=0.60) -> np.ndarray:
    """Left→right NDRE gradient with a NaN (invalid) border."""
    g = np.tile(np.linspace(lo, hi, shape[1], dtype=np.float32), (shape[0], 1))
    g[0, :] = np.nan
    g[:, 0] = np.nan
    return g


def test_si_uses_95th_percentile_reference_and_caps_at_1():
    g = _grid()
    g[5, 5] = 0.90                             # single hot outlier pixel
    si, ref, bare = sfy._si_surface(g)
    valid = g[np.isfinite(g)]                  # all above the bare cutoff here
    assert not bare.any()
    assert ref == pytest.approx(float(np.percentile(valid, 95)))
    assert ref < 0.90                          # robust reference, NOT the max pixel
    finite = si[np.isfinite(si)]
    assert float(finite.max()) <= 1.0          # capped (outlier > reference clamps to 1)
    assert float(finite.min()) == pytest.approx(float(valid.min()) / ref, abs=1e-3)


def test_bare_soil_pixels_excluded_from_reference_map_and_zones():
    """Half the field unplanted (NDRE 0.05): bare pixels must not touch the
    reference, must be NaN in the SI surface (rendered neutral, not red), and
    must not appear in exported zones."""
    f = _field()
    g = _grid(lo=0.30, hi=0.60)
    g[:, : g.shape[1] // 2] = 0.05             # left half bare / unplanted
    si, ref, bare = sfy._si_surface(g)

    crop_vals = g[np.isfinite(g) & (g >= sfy.BARE_SOIL_NDRE)]
    assert ref == pytest.approx(float(np.percentile(crop_vals, 95)))  # cropped-only reference
    assert bare.sum() == int((np.isfinite(g) & (g < sfy.BARE_SOIL_NDRE)).sum())
    assert np.isnan(si[bare]).all()            # bare = no SI value (excluded from map/%)
    # SI over crop only → min SI reflects the 0.30 edge, never the 0.05 bare ground
    finite = si[np.isfinite(si)]
    assert float(finite.min()) >= 0.30 / ref - 1e-3

    feats = sfy._zone_features(f, si, g, threshold=0.95)
    assert feats                                # zones exist over the cropped half
    lon0, _lat0, lon1, _lat1 = f.bbox
    mid = lon0 + (lon1 - lon0) / 2
    from shapely.geometry import shape as shp_shape
    for ft in feats:                            # no zone extends into the bare (west) half
        assert shp_shape(ft["geometry"]).bounds[0] >= mid - 1e-9
        assert ft["properties"]["ndre_mean"] >= sfy.BARE_SOIL_NDRE


def test_low_si_location_directions_and_pattern():
    """Below-threshold cluster placement → compass direction + pattern.
    Grid row 0 = north; col 0 = west."""
    si = np.full((20, 20), 0.98, dtype=np.float32)
    si[14:20, 0:6] = 0.80                       # tight block: south rows, west cols
    loc = sfy._low_si_location(si, threshold=0.95)
    assert loc["direction"] == "southwest" and loc["pattern"] == "concentrated"
    assert loc["n_pixels"] == 36

    si2 = np.full((20, 20), 0.98, dtype=np.float32)
    si2[0:4, :] = 0.80                          # northern edge band
    loc2 = sfy._low_si_location(si2, threshold=0.95)
    assert loc2["direction"] == "north"

    rng = np.random.default_rng(42)             # scattered everywhere
    si3 = np.full((20, 20), 0.98, dtype=np.float32)
    pick = rng.random((20, 20)) < 0.25
    si3[pick] = 0.85
    loc3 = sfy._low_si_location(si3, threshold=0.95)
    assert loc3["pattern"] == "scattered"

    assert sfy._low_si_location(np.full((5, 5), 0.99, dtype=np.float32), 0.95)["pattern"] == "none below threshold"


def test_gating_blocks_sparse_canopy_and_stale_scene():
    today = date.today().isoformat()
    bare = np.full((10, 10), 0.10, dtype=np.float32)      # entirely below the bare cutoff
    with pytest.raises(sfy.SufficiencyUnavailable):
        sfy._si_surface(bare)                              # no cropped area -> no SI read
    ok = np.full((10, 10), 0.45, dtype=np.float32)
    sfy._gate(ok, today)                                   # healthy canopy passes
    old = (date.today() - timedelta(days=sfy.MAX_SCENE_AGE_DAYS + 5)).isoformat()
    with pytest.raises(sfy.SufficiencyUnavailable):
        sfy._gate(ok, old)                                 # stale scene blocked
    mostly_invalid = np.full((10, 10), np.nan, dtype=np.float32)
    mostly_invalid[0, 0] = 0.45
    with pytest.raises(sfy.SufficiencyUnavailable):
        sfy._gate(mostly_invalid, today)                   # too few valid pixels


def test_zones_classify_into_5_with_attributes():
    f = _field()
    g = _grid()
    si, ref, _bare = sfy._si_surface(g)
    feats = sfy._zone_features(f, si, g, threshold=0.95)
    assert 1 <= len(feats) <= sfy.N_ZONES
    classes = sorted(ft["properties"]["SI_class"] for ft in feats)
    assert classes == sorted(set(classes)) and all(1 <= c <= 5 for c in classes)
    for ft in feats:
        pr = ft["properties"]
        assert set(pr) == {"SI_value", "SI_class", "ndre_mean", "below_threshold"}
        assert 0.0 <= pr["SI_value"] <= 1.0
        assert isinstance(pr["below_threshold"], bool)
        assert ft["geometry"]["type"] in ("Polygon", "MultiPolygon")
    # low class ⇒ lower zone-mean SI than high class
    by_class = {ft["properties"]["SI_class"]: ft["properties"]["SI_value"] for ft in feats}
    ks = sorted(by_class)
    assert by_class[ks[0]] < by_class[ks[-1]]


def test_fetch_grid_rejects_poisoned_cache_and_corrupt_decode(tmp_path, monkeypatch):
    """A cached grid with out-of-range values is discarded + refetched; a corrupt
    fresh decode is discarded (never cached) and surfaces as SentinelError."""
    import io as _io
    import tifffile
    from app.field import sentinel as sentinel_mod

    f = _field()
    monkeypatch.setattr(sfy.field_store, "cache_path", lambda fid, name: tmp_path / name)

    good = np.full((10, 10), 0.42, dtype=np.float32)
    buf = _io.BytesIO()
    tifffile.imwrite(buf, good)

    class FakeClient:
        def __init__(self, *a, **k): ...
        def index_raw_tiff(self, *a, **k):
            return buf.getvalue()

    monkeypatch.setattr(sfy, "SentinelClient", FakeClient)

    # poisoned cache (PIL-era garbage signature) → rejected, deleted, refetched clean
    cache = tmp_path / "si_grid_2026-07-03.npz"
    poison = np.array([[0.0, -855.39], [3.3e38, 0.1]], dtype=np.float32)
    np.savez_compressed(cache, ndre=poison)
    grid = sfy._fetch_grid(f, "2026-07-03")
    assert float(np.nanmedian(grid)) == pytest.approx(0.42)
    assert sfy._grid_ok(np.load(cache)["ndre"])       # cache rewritten with the clean grid

    # corrupt fresh decode → SentinelError, nothing cached
    bad = np.full((10, 10), 3.3e38, dtype=np.float32)
    bad_buf = _io.BytesIO()
    tifffile.imwrite(bad_buf, bad)
    FakeClient.index_raw_tiff = lambda self, *a, **k: bad_buf.getvalue()
    cache2 = tmp_path / "si_grid_2026-07-08.npz"
    with pytest.raises(sentinel_mod.SentinelError):
        sfy._fetch_grid(f, "2026-07-08")
    assert not cache2.exists()


def test_exports_geojson_and_shapefile_zip(monkeypatch):
    f = _field()
    g = _grid()
    monkeypatch.setattr(sfy, "_resolve_scene", lambda *a, **k: date.today().isoformat())
    monkeypatch.setattr(sfy, "_fetch_grid", lambda *a, **k: g)

    data, fname = sfy.export_geojson(f, "2026-01-01", "2026-12-31", threshold=0.9)
    fc = json.loads(data)
    assert fname.endswith(".geojson")
    assert fc["type"] == "FeatureCollection" and fc["features"]
    meta = fc["metadata"]
    assert "95th-percentile" in meta["reference_method"]
    assert meta["threshold"] == 0.9 and "NOT a validated nitrogen prescription" in meta["caveat"]

    zdata, zname = sfy.export_shapefile_zip(f, "2026-01-01", "2026-12-31", threshold=0.9)
    assert zname.endswith(".zip")
    with zipfile.ZipFile(io.BytesIO(zdata)) as z:
        names = z.namelist()
        for ext in (".shp", ".shx", ".dbf", ".prj"):
            assert any(n.endswith(ext) for n in names), f"missing {ext}"
        assert "README.txt" in names
        readme = z.read("README.txt").decode()
        assert "NOT a validated nitrogen prescription" in readme
        assert "95th-percentile" in readme
        assert 'GCS_WGS_1984' in z.read([n for n in names if n.endswith(".prj")][0]).decode()
        # shapefile is readable and carries the attribute table
        import shapefile as pyshp
        r = pyshp.Reader(shp=io.BytesIO(z.read([n for n in names if n.endswith(".shp")][0])),
                         shx=io.BytesIO(z.read([n for n in names if n.endswith(".shx")][0])),
                         dbf=io.BytesIO(z.read([n for n in names if n.endswith(".dbf")][0])))
        assert [fld[0] for fld in r.fields[1:]] == ["SI_value", "SI_class", "ndre_mean", "below_thr"]
        assert len(r.shapes()) == len(r.records()) >= 1
