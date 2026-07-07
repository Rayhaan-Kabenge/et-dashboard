"""Process-API request builder for a colorized index PNG (Stage 3).

Green (high) -> amber -> red (low) ramp, clipped to the field, transparent where
invalid (clouds/no-data). Dimensions derived from the bbox aspect, capped at 512.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Optional

# normalization range per index (typical healthy-canopy span)
_NORM = {"NDRE": (0.1, 0.6), "NDVI": (0.2, 0.85)}
_INVALID_SCL = "[0,1,3,8,9,10,11]"


def _dims(bbox: list[float], cap: int = 512) -> tuple[int, int]:
    lon0, lat0, lon1, lat1 = bbox
    lat_c = math.radians((lat0 + lat1) / 2)
    w_deg = max(1e-6, (lon1 - lon0) * math.cos(lat_c))
    h_deg = max(1e-6, lat1 - lat0)
    aspect = w_deg / h_deg
    if aspect >= 1:
        w = cap
        h = max(64, round(cap / aspect))
    else:
        h = cap
        w = max(64, round(cap * aspect))
    return int(w), int(h)


def _colorize_evalscript(index: str) -> str:
    red = "B04" if index.upper() == "NDVI" else "B05"
    lo, hi = _NORM.get(index.upper(), (0.1, 0.6))
    return f"""//VERSION=3
function setup() {{
  return {{ input: ["{red}","B08","SCL","dataMask"], output: {{ bands: 4, sampleType: "AUTO" }} }};
}}
function ramp(t) {{
  t = Math.max(0, Math.min(1, t));
  if (t < 0.5) {{ let u = t / 0.5; return [0.75+u*0.04, 0.22+u*0.29, 0.17-u*0.05]; }}
  let u = (t - 0.5) / 0.5; return [0.79-u*0.61, 0.51-u*0.02, 0.12+u*0.17];
}}
function evaluatePixel(s) {{
  let valid = s.dataMask;
  if ({_INVALID_SCL}.includes(s.SCL)) valid = 0;
  let idx = (s.B08 - s.{red}) / (s.B08 + s.{red} + 1e-6);
  let t = (idx - {lo}) / ({hi} - {lo});
  let c = ramp(t);
  return [c[0], c[1], c[2], valid];
}}"""


def _raw_evalscript(index: str) -> str:
    """Raw index values as FLOAT32; invalid pixels (clouds/shadow/no-data and
    anything outside the polygon, via dataMask) carry the sentinel -999."""
    red = "B04" if index.upper() == "NDVI" else "B05"
    return f"""//VERSION=3
function setup() {{
  return {{ input: ["{red}","B08","SCL","dataMask"], output: {{ bands: 1, sampleType: "FLOAT32" }} }};
}}
function evaluatePixel(s) {{
  let valid = s.dataMask;
  if ({_INVALID_SCL}.includes(s.SCL)) valid = 0;
  if (valid === 0) return [-999];
  let idx = (s.B08 - s.{red}) / (s.B08 + s.{red} + 1e-6);
  return [idx];
}}"""


def build_raw_request(geometry: dict, index: str, date_str: str, width: int, height: int) -> dict:
    """Process-API body for the raw FLOAT32 TIFF of ONE scene date."""
    start = date_str
    end = (date.fromisoformat(date_str) + timedelta(days=1)).isoformat()
    return {
        "input": {
            "bounds": {"geometry": geometry, "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"}},
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {"from": f"{start}T00:00:00Z", "to": f"{end}T23:59:59Z"},
                    "mosaickingOrder": "leastCC",
                    "maxCloudCoverage": 80,
                },
            }],
        },
        "output": {
            "width": width,
            "height": height,
            "responses": [{"identifier": "default", "format": {"type": "image/tiff"}}],
        },
        "evalscript": _raw_evalscript(index),
    }


def build_process_request(geometry: dict, bbox: list[float], index: str, date_str: Optional[str], size: int = 512) -> dict:
    w, h = _dims(bbox, cap=size)
    if date_str and date_str != "latest":
        start = date_str
        end = (date.fromisoformat(date_str) + timedelta(days=1)).isoformat()
        mosaicking = "leastCC"
    else:
        # "latest": widest practical window + mostRecent so we always pick the
        # newest AVAILABLE scene (robust to clock skew vs the catalog).
        end = date.today().isoformat()
        start = (date.today() - timedelta(days=1095)).isoformat()
        mosaicking = "mostRecent"
    max_cloud = 80 if (date_str and date_str != "latest") else 20  # latest = most recent CLEAR scene
    return {
        "input": {
            "bounds": {"geometry": geometry, "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"}},
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {"from": f"{start}T00:00:00Z", "to": f"{end}T23:59:59Z"},
                    "mosaickingOrder": mosaicking,
                    "maxCloudCoverage": max_cloud,
                },
            }],
        },
        "output": {
            "width": w,
            "height": h,
            "responses": [{"identifier": "default", "format": {"type": "image/png"}}],
        },
        "evalscript": _colorize_evalscript(index),
    }
