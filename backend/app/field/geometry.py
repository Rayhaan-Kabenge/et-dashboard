"""Pure-Python geometry helpers for a GeoJSON Polygon (WGS84/EPSG:4326).

No shapely/geo deps — field-scale accuracy via a local equirectangular projection.
"""
from __future__ import annotations

import math

EARTH_R = 6378137.0  # m (WGS84 mean)
ACRE_M2 = 4046.8564224


def _ring(geometry: dict) -> list[list[float]]:
    """Exterior ring of a GeoJSON Polygon, ensured closed."""
    coords = geometry["coordinates"][0]
    if coords and coords[0] != coords[-1]:
        coords = coords + [coords[0]]
    return coords


def bbox(geometry: dict) -> list[float]:
    ring = _ring(geometry)
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return [min(lons), min(lats), max(lons), max(lats)]


def centroid(geometry: dict) -> list[float]:
    """Area-weighted polygon centroid [lon, lat]."""
    ring = _ring(geometry)
    a = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-12:  # degenerate — fall back to vertex mean
        n = len(ring) - 1 or 1
        return [sum(p[0] for p in ring[:-1]) / n, sum(p[1] for p in ring[:-1]) / n]
    a *= 0.5
    return [cx / (6 * a), cy / (6 * a)]


def area_acres(geometry: dict) -> float:
    """Polygon area in acres via local equirectangular projection."""
    ring = _ring(geometry)
    lat0 = centroid(geometry)[1]
    mx = math.cos(math.radians(lat0)) * EARTH_R * math.pi / 180.0  # m per deg lon
    my = EARTH_R * math.pi / 180.0  # m per deg lat
    pts = [(p[0] * mx, p[1] * my) for p in ring]
    a = 0.0
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2.0 / ACRE_M2


def validate_polygon(geometry) -> str | None:
    """Return an error string if `geometry` is not a usable WGS84 Polygon, else None."""
    if not isinstance(geometry, dict):
        return "geometry must be a GeoJSON object"
    if geometry.get("type") != "Polygon":
        return f"geometry.type must be 'Polygon', got {geometry.get('type')!r}"
    coords = geometry.get("coordinates")
    if not isinstance(coords, list) or not coords or not isinstance(coords[0], list):
        return "geometry.coordinates must be a non-empty ring array"
    ring = coords[0]
    if len(ring) < 4:
        return "polygon ring needs at least 4 positions (closed)"
    for p in ring:
        if not (isinstance(p, (list, tuple)) and len(p) >= 2):
            return "each position must be [lon, lat]"
        lon, lat = p[0], p[1]
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            return f"position out of WGS84 range: {p}"
    return None
