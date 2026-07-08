"""Nitrogen Sufficiency Index (SI) — relative within-field sufficiency from NDRE.

Built on the SAME Sentinel-2 pixel pipeline as the Latest-image panel (raw
per-pixel NDRE for the most recent cloud-free scene in range). Isolated: imports
only ..config + this package — no engine imports.

Method (honest framing — this is NOT a nitrogen prescription):
- reference = 95th percentile of in-boundary NDRE for the scene (robust
  "virtual reference", not the single max pixel);
- SI(pixel) = NDRE(pixel) / reference, capped at 1.0;
- pixels below a user threshold (default 0.95) are flagged "investigate".
An internal reference can only show WITHIN-field variability — it cannot detect
whole-field deficiency. Low SI may reflect water, soil, or stand differences.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import zipfile
from datetime import date as _date, datetime, timezone
from typing import Optional

import numpy as np
from PIL import Image

_log = logging.getLogger("app.field.sufficiency")

from ..config import get_settings
from . import field_store, indices
from .schemas import Field
from .sentinel import SentinelClient, SentinelError

INDEX = "NDRE"                 # SI is NDRE-only by design
SENTINEL_NODATA = -900.0       # raw grid: values <= this are invalid (-999 sentinel)
REFERENCE_PCT = 95             # robust virtual reference
DEFAULT_THRESHOLD = 0.95
HIST_BINS = 101                # SI histogram, 0.01-wide bins over [0, 1]
N_ZONES = 5

# gating — SI is meaningless with sparse canopy or a stale scene
MAX_SCENE_AGE_DAYS = 30
MIN_VALID_FRACTION = 0.25      # under a quarter valid pixels = don't trust the map

# per-pixel bare-soil mask — SI is computed over actively growing crop only.
# Pixels with NDRE below this floor ("no meaningful canopy": bare/unplanted
# ground) are excluded from the reference, the SI map (rendered neutral, not
# red), the below-threshold %, and the exported zones. Tunable.
BARE_SOIL_NDRE = 0.20
MIN_CROPPED_FRACTION = 0.10    # under this share of cropped pixels = no SI read

# display normalization for the heat map (fixed so colors compare across scenes)
_SI_NORM = (0.5, 1.0)

CAVEAT = (
    "Relative within-field sufficiency zones to investigate, NOT a validated "
    "nitrogen prescription. Low-SI zones may reflect water, soil, or stand "
    "differences, not only nitrogen. An internal (within-field) reference cannot "
    "detect whole-field deficiency. Cross-check against soil water before applying N."
)

WGS84_PRJ = (
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,'
    '298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'
)


class SufficiencyUnavailable(Exception):
    """SI can't be computed honestly right now; .reason explains why."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# --------------------------------------------------------------------------- #
# raw per-pixel grid (cached per field + scene)
# --------------------------------------------------------------------------- #
def _grid_dims(bbox: list[float], meters_per_px: float = 10.0, cap: int = 512) -> tuple[int, int]:
    import math
    lon0, lat0, lon1, lat1 = bbox
    lat_c = math.radians((lat0 + lat1) / 2)
    w_m = max(1.0, (lon1 - lon0) * 111_320.0 * math.cos(lat_c))
    h_m = max(1.0, (lat1 - lat0) * 111_320.0)
    w = int(max(8, min(cap, round(w_m / meters_per_px))))
    h = int(max(8, min(cap, round(h_m / meters_per_px))))
    return w, h


GRID_VALUE_LIMIT = 1.05        # NDRE is bounded to [-1, 1]; anything beyond = corrupt decode


def _grid_ok(grid: np.ndarray) -> bool:
    """A sane NDRE grid keeps every finite value inside ±GRID_VALUE_LIMIT.
    An all-masked grid is legitimate (fully cloudy) — the gate handles that."""
    fin = grid[np.isfinite(grid)]
    if fin.size == 0:
        return True
    return bool(np.abs(fin).max() <= GRID_VALUE_LIMIT)


def _fetch_grid(field: Field, scene_date: str) -> np.ndarray:
    """Raw NDRE grid (float32, NaN = invalid/outside boundary) for one scene,
    cached on disk per field + scene date. Grids are validated on cache-load AND
    post-decode so a corrupt decode can never poison the cache (self-healing)."""
    cache = field_store.cache_path(field.id, f"si_grid_{scene_date}.npz")
    if cache.exists():
        try:
            grid = np.load(cache)["ndre"]
            if _grid_ok(grid):
                return grid
            _log.warning("discarding poisoned SI grid cache %s (values outside ±%s) — refetching",
                         cache.name, GRID_VALUE_LIMIT)
            cache.unlink(missing_ok=True)
        except Exception:
            pass
    s = get_settings()
    client = SentinelClient(s.sh_client_id, s.sh_client_secret)
    w, h = _grid_dims(field.bbox)
    tif = client.index_raw_tiff(field.geometry, field.bbox, INDEX, scene_date, w, h)
    import tifffile  # PIL garbles SH's tiled float32 TIFFs; tifffile reads them right
    arr = np.asarray(tifffile.imread(io.BytesIO(tif)), dtype=np.float32)
    if arr.ndim == 3:                      # defensive: some encoders add a band axis
        arr = arr[..., 0]
    grid = np.where(arr <= SENTINEL_NODATA, np.nan, arr)
    if not _grid_ok(grid):                 # discard, don't cache — surfaces as "unavailable"
        _log.warning("raw NDRE decode for %s scene %s failed validation (values outside ±%s) — discarded",
                     field.id, scene_date, GRID_VALUE_LIMIT)
        raise SentinelError("raw NDRE decode failed validation — try again shortly.")
    try:
        np.savez_compressed(cache, ndre=grid)
    except OSError:
        pass
    return grid


def _resolve_scene(field: Field, start: str, end: str) -> str:
    """Most recent cloud-free scene in range — the SAME resolution the Latest-image
    panel uses (indices.get_index_series → last_observation)."""
    _points, last_obs, note = indices.get_index_series(field, INDEX, start, end)
    if not last_obs:
        raise SufficiencyUnavailable(note or "No cloud-free scene in this range.")
    return last_obs


# --------------------------------------------------------------------------- #
# SI computation + gating
# --------------------------------------------------------------------------- #
def _si_surface(ndre: np.ndarray) -> tuple[np.ndarray, float, np.ndarray]:
    """SI over CROPPED pixels only. Bare-soil pixels (NDRE < BARE_SOIL_NDRE) are
    excluded from the reference and carry NaN in the SI surface; the returned
    bare mask drives the neutral rendering. The ratio math and the
    95th-percentile reference logic are unchanged — just computed over crop."""
    finite = np.isfinite(ndre)
    bare = finite & (ndre < BARE_SOIL_NDRE)
    crop = finite & ~bare
    n_finite = int(finite.sum())
    cropped_fraction = crop.sum() / n_finite if n_finite else 0.0
    if n_finite == 0 or cropped_fraction < MIN_CROPPED_FRACTION:
        raise SufficiencyUnavailable(
            f"Only {cropped_fraction:.0%} of the field shows meaningful canopy "
            f"(NDRE ≥ {BARE_SOIL_NDRE}) — not enough cropped area for a sufficiency read "
            "(early season / bare soil).")
    reference = float(np.percentile(ndre[crop], REFERENCE_PCT))
    if reference <= 0:
        raise SufficiencyUnavailable("Reference NDRE is non-positive — no usable canopy signal.")
    si = np.where(crop, np.clip(ndre / reference, 0.0, 1.0), np.nan)
    return si, reference, bare


def _gate(ndre: np.ndarray, scene_date: str, ref_date: Optional[str] = None) -> None:
    finite = np.isfinite(ndre)
    if finite.mean() < MIN_VALID_FRACTION:
        raise SufficiencyUnavailable(
            f"Only {finite.mean():.0%} of the field has valid pixels for this scene — SI unavailable.")
    # staleness is judged against the END of the requested range (defaults to today
    # in the API), so live use requires a recent scene while historical ranges with
    # a scene near the window's end stay coherent. (Canopy sufficiency is gated
    # per-pixel in _si_surface via the bare-soil mask / MIN_CROPPED_FRACTION.)
    ref = _date.fromisoformat(ref_date) if ref_date else _date.today()
    age = (min(ref, _date.today()) - _date.fromisoformat(scene_date)).days
    if age > MAX_SCENE_AGE_DAYS:
        raise SufficiencyUnavailable(
            f"Latest cloud-free scene is {age} days older than the selected window's end "
            f"(> {MAX_SCENE_AGE_DAYS}) — SI unavailable.")


def _ramp(t: np.ndarray) -> np.ndarray:
    """Same low→high color ramp as the existing NDRE thumbnails (red→amber→green)."""
    t = np.clip(t, 0.0, 1.0)
    rgb = np.empty(t.shape + (3,), dtype=np.float32)
    lo = t < 0.5
    u = np.where(lo, t / 0.5, (t - 0.5) / 0.5)
    rgb[..., 0] = np.where(lo, 0.75 + u * 0.04, 0.79 - u * 0.61)
    rgb[..., 1] = np.where(lo, 0.22 + u * 0.29, 0.51 - u * 0.02)
    rgb[..., 2] = np.where(lo, 0.17 - u * 0.05, 0.12 + u * 0.17)
    return rgb


_BARE_RGB = (140, 143, 138)    # neutral grey for bare/unplanted — distinctly NOT the stress ramp


def _heatmap_png(si: np.ndarray, bare: Optional[np.ndarray] = None, upscale_to: int = 512) -> bytes:
    lo, hi = _SI_NORM
    t = (si - lo) / (hi - lo)
    rgb = (_ramp(t) * 255).astype(np.uint8)
    alpha = np.where(np.isfinite(si), 255, 0).astype(np.uint8)
    if bare is not None and bare.any():        # bare ground: neutral, opaque, no SI color
        rgb[bare] = _BARE_RGB
        alpha = np.where(bare, 255, alpha).astype(np.uint8)
    img = Image.fromarray(np.dstack([rgb, alpha[..., None]]), "RGBA")
    scale = max(1, round(upscale_to / max(img.width, img.height)))
    if scale > 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def compute(field: Field, start: str, end: str, threshold: float = DEFAULT_THRESHOLD) -> dict:
    """The full SI read for the panel. Raises SufficiencyUnavailable for the
    graceful gated states; SentinelError bubbles to the caller's handler."""
    scene_date = _resolve_scene(field, start, end)
    ndre = _fetch_grid(field, scene_date)
    _gate(ndre, scene_date, ref_date=end)
    si, reference, bare = _si_surface(ndre)

    # cropped pixels only: bare ground is NaN in the SI surface, so the
    # histogram and the below-threshold % denominator cover crop, not field area
    cropped = si[np.isfinite(si)]
    n_valid = int(np.isfinite(ndre).sum())
    cropped_fraction = float(cropped.size / n_valid) if n_valid else 0.0
    hist, _edges = np.histogram(cropped, bins=HIST_BINS, range=(0.0, 1.01))
    pct_below = float((cropped < threshold).mean() * 100.0)

    return {
        "status": "ok",
        "field_id": field.id,
        "index": INDEX,
        "scene_date": scene_date,
        "reference_ndre": round(reference, 4),
        "reference_method": f"{REFERENCE_PCT}th percentile of cropped in-field NDRE",
        "canopy_median_ndre": round(float(np.nanmedian(ndre)), 4),
        "valid_fraction": round(float(np.isfinite(ndre).mean()), 3),
        "bare_soil_cutoff": BARE_SOIL_NDRE,
        "cropped_fraction": round(cropped_fraction, 3),
        "bare_fraction": round(1.0 - cropped_fraction, 3),
        "threshold": threshold,
        "pct_below_threshold": round(pct_below, 1),
        "histogram": hist.tolist(),           # 0.01-wide SI bins over [0, 1.01), cropped px only
        "png_base64": base64.b64encode(_heatmap_png(si, bare)).decode(),
        "bbox": field.bbox,
        "caveat": CAVEAT,
    }


# --------------------------------------------------------------------------- #
# spatial stats for the AI summary (numbers only — Claude narrates, never computes)
# --------------------------------------------------------------------------- #
def _low_si_location(si: np.ndarray, threshold: float) -> dict:
    """Where the below-threshold (cropped) pixels sit relative to the field:
    8-way compass direction of their centroid + concentrated/scattered pattern.
    Grid row 0 is the field's north edge."""
    below = np.isfinite(si) & (si < threshold)
    n = int(below.sum())
    if n == 0:
        return {"pattern": "none below threshold"}
    h, w = si.shape
    rows, cols = np.nonzero(below)
    dx = (cols.mean() + 0.5) / w - 0.5          # + = east of field center
    dy = 0.5 - (rows.mean() + 0.5) / h          # + = north of field center
    dist = float(np.hypot(dx, dy))
    if dist < 0.10:
        direction = "around the center of the field"
    else:
        names = ["east", "northeast", "north", "northwest", "west", "southwest", "south", "southeast"]
        octant = int(np.round(np.arctan2(dy, dx) / (np.pi / 4))) % 8
        direction = names[octant]
    spread = float(np.hypot(cols.std() / w, rows.std() / h))
    pattern = "concentrated" if spread < 0.18 else "scattered"
    return {"direction": direction, "pattern": pattern, "n_pixels": n}


def spatial_stats(field: Field, start: str, end: str, threshold: float) -> dict:
    """Numeric SI block for the spatial summary — masked computation (cropped
    pixels only; bare soil already excluded). Raises SufficiencyUnavailable /
    SentinelError for the caller's graceful states."""
    scene_date = _resolve_scene(field, start, end)
    ndre = _fetch_grid(field, scene_date)
    _gate(ndre, scene_date, ref_date=end)
    si, reference, bare = _si_surface(ndre)
    cropped = si[np.isfinite(si)]
    n_valid = int(np.isfinite(ndre).sum())
    cropped_fraction = float(cropped.size / n_valid) if n_valid else 0.0
    return {
        "available": True,
        "scene_date": scene_date,
        "reference_method": f"{REFERENCE_PCT}th percentile of cropped in-field NDRE (internal virtual reference)",
        # 3 decimals — identical to what the SI card displays, so the narrated
        # reference matches the panel figure exactly
        "reference_ndre": round(reference, 3),
        "threshold": threshold,
        "bare_soil_cutoff_ndre": BARE_SOIL_NDRE,
        "pct_of_cropped_area_below_threshold": round(float((cropped < threshold).mean() * 100.0), 1),
        "cropped_fraction_of_field": round(cropped_fraction, 3),
        "bare_or_unplanted_fraction_excluded": round(1.0 - cropped_fraction, 3),
        "si_min": round(float(cropped.min()), 3),
        "si_median": round(float(np.median(cropped)), 3),
        "low_si_zone_location": _low_si_location(si, threshold),
    }


# --------------------------------------------------------------------------- #
# 5-zone classification + vector export
# --------------------------------------------------------------------------- #
def _zone_features(field: Field, si: np.ndarray, ndre: np.ndarray, threshold: float) -> list[dict]:
    """Classify SI into N_ZONES equal-width bins and dissolve pixels into zone
    polygons (WGS84). Each feature: SI_value (bin mean), SI_class (1=lowest),
    ndre_mean, below_threshold."""
    from shapely.geometry import box, mapping, shape
    from shapely.ops import unary_union

    h, w = si.shape
    lon0, lat0, lon1, lat1 = field.bbox
    dx = (lon1 - lon0) / w
    dy = (lat1 - lat0) / h
    boundary = shape(field.geometry)

    finite = si[np.isfinite(si)]
    lo = float(finite.min())
    span = max(1.0 - lo, 0.05)               # degenerate (uniform) fields still bin
    edges = [lo + span * k / N_ZONES for k in range(N_ZONES)] + [1.0 + 1e-9]

    features: list[dict] = []
    for k in range(N_ZONES):
        mask = np.isfinite(si) & (si >= edges[k]) & (si < edges[k + 1])
        if not mask.any():
            continue
        rows, cols = np.nonzero(mask)
        # pixel squares in lon/lat (row 0 = north edge of the bbox)
        cells = [box(lon0 + c * dx, lat1 - (r + 1) * dy, lon0 + (c + 1) * dx, lat1 - r * dy)
                 for r, c in zip(rows.tolist(), cols.tolist())]
        geom = unary_union(cells).intersection(boundary)
        if geom.is_empty:
            continue
        geom = geom.simplify(min(dx, dy) / 2, preserve_topology=True)
        si_value = float(si[mask].mean())
        features.append({
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": {
                "SI_value": round(si_value, 4),
                "SI_class": k + 1,
                "ndre_mean": round(float(ndre[mask].mean()), 4),
                "below_threshold": bool(si_value < threshold),
            },
        })
    return features


def _zone_metadata(field: Field, scene_date: str, reference: float, threshold: float,
                   cropped_fraction: float) -> dict:
    return {
        "field_id": field.id,
        "field_name": field.name,
        "index": INDEX,
        "scene_date": scene_date,
        "reference_method": f"{REFERENCE_PCT}th-percentile NDRE (cropped in-field virtual reference)",
        "reference_ndre": round(reference, 4),
        "threshold": threshold,
        "zones": N_ZONES,
        "bare_soil_cutoff_ndre": BARE_SOIL_NDRE,
        "cropped_fraction": round(cropped_fraction, 3),
        "crs": "EPSG:4326 (WGS84)",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "caveat": CAVEAT,
    }


def _zones(field: Field, start: str, end: str, threshold: float) -> tuple[list[dict], dict]:
    scene_date = _resolve_scene(field, start, end)
    ndre = _fetch_grid(field, scene_date)
    _gate(ndre, scene_date, ref_date=end)
    si, reference, _bare = _si_surface(ndre)
    # bare pixels carry NaN in the SI surface, so zone masks (np.isfinite) skip
    # them — bare/unplanted ground never becomes a prescription zone
    n_valid = int(np.isfinite(ndre).sum())
    cropped_fraction = float(np.isfinite(si).sum() / n_valid) if n_valid else 0.0
    return (_zone_features(field, si, ndre, threshold),
            _zone_metadata(field, scene_date, reference, threshold, cropped_fraction))


def export_geojson(field: Field, start: str, end: str, threshold: float) -> tuple[bytes, str]:
    features, meta = _zones(field, start, end, threshold)
    fc = {"type": "FeatureCollection", "metadata": meta, "features": features}
    fname = f"{field.name or field.id}_SI_zones_{meta['scene_date']}.geojson".replace(" ", "_")
    return json.dumps(fc).encode("utf-8"), fname


def export_shapefile_zip(field: Field, start: str, end: str, threshold: float) -> tuple[bytes, str]:
    import shapefile  # pyshp
    from shapely.geometry import shape as shp_shape
    from shapely.geometry.polygon import orient

    features, meta = _zones(field, start, end, threshold)

    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    with shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON) as w:
        # DBF names are capped at 10 chars — below_threshold → below_thr (README notes it)
        w.field("SI_value", "N", 19, 4)
        w.field("SI_class", "N", 9, 0)
        w.field("ndre_mean", "N", 19, 4)
        w.field("below_thr", "N", 1, 0)
        for f in features:
            geom = shp_shape(f["geometry"])
            polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
            rings: list[list[list[float]]] = []
            for p in polys:
                p = orient(p, sign=-1.0)   # ESRI: exterior CW, holes CCW
                rings.append([list(c) for c in p.exterior.coords])
                rings.extend([list(c) for c in ring.coords] for ring in p.interiors)
            w.poly(rings)
            pr = f["properties"]
            w.record(pr["SI_value"], pr["SI_class"], pr["ndre_mean"], 1 if pr["below_threshold"] else 0)

    stem = f"{field.name or field.id}_SI_zones_{meta['scene_date']}".replace(" ", "_")
    readme = (
        "Sufficiency-Index (SI) management zones\n"
        "=======================================\n"
        f"Field:            {meta['field_name']} (id {meta['field_id']})\n"
        f"Scene date:       {meta['scene_date']} (Sentinel-2 L2A)\n"
        f"Index:            {meta['index']}\n"
        f"Reference method: {meta['reference_method']}\n"
        f"Reference NDRE:   {meta['reference_ndre']}\n"
        f"Threshold used:   {meta['threshold']}\n"
        f"Bare-soil cutoff: NDRE < {meta['bare_soil_cutoff_ndre']} excluded (bare/unplanted)\n"
        f"Cropped fraction: {meta['cropped_fraction']:.0%} of valid field pixels\n"
        f"CRS:              {meta['crs']}\n"
        f"Generated:        {meta['generated_at']}\n\n"
        "Zones cover the CROPPED area only — bare/unplanted ground is excluded\n"
        "and is not a prescription zone.\n\n"
        "Attributes: SI_value (zone mean SI), SI_class (1=lowest..5=highest),\n"
        "ndre_mean (zone mean NDRE), below_thr (1 = zone mean SI below threshold;\n"
        "DBF caps field names at 10 chars, hence 'below_thr').\n\n"
        f"CAVEAT: {CAVEAT}\n"
    )
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{stem}.shp", shp.getvalue())
        z.writestr(f"{stem}.shx", shx.getvalue())
        z.writestr(f"{stem}.dbf", dbf.getvalue())
        z.writestr(f"{stem}.prj", WGS84_PRJ)
        z.writestr("README.txt", readme)
    return zbuf.getvalue(), f"{stem}.zip"
