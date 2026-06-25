"""CDSE Sentinel Hub client (raw REST via httpx) — OAuth + Statistical/Process API.

Isolated: imports nothing from the irrigation engine. Lightweight (no sentinelhub
package / geo deps). All network calls raise `SentinelError` on failure so the
service layer can degrade gracefully (empty series, never a 500).
"""
from __future__ import annotations

import time
from typing import Optional

import httpx

TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
BASE_URL = "https://sh.dataspace.copernicus.eu"
STATS_URL = f"{BASE_URL}/api/v1/statistics"
PROCESS_URL = f"{BASE_URL}/api/v1/process"
COLLECTION = "sentinel-2-l2a"

# SCL classes treated as invalid (cloud shadow / cloud / cirrus / snow) + no-data
# (0) and saturated (1). dataMask is also honoured.
_INVALID_SCL = "[0,1,3,8,9,10,11]"


def evalscript(index: str) -> str:
    """Statistical-API evalscript: outputs the index + a dataMask that is 0 for
    invalid (clouds/shadow/snow/no-data) pixels."""
    red = "B04" if index.upper() == "NDVI" else "B05"  # NDVI=red, NDRE=red-edge
    return f"""//VERSION=3
function setup() {{
  return {{
    input: [{{ bands: ["{red}","B08","SCL","dataMask"] }}],
    output: [{{ id: "index", bands: 1, sampleType: "FLOAT32" }},
             {{ id: "dataMask", bands: 1 }}]
  }};
}}
function evaluatePixel(s) {{
  let valid = s.dataMask;
  if ({_INVALID_SCL}.includes(s.SCL)) valid = 0;
  let idx = (s.B08 - s.{red}) / (s.B08 + s.{red} + 1e-6);
  return {{ index: [idx], dataMask: [valid] }};
}}"""


class SentinelError(Exception):
    """Any failure talking to CDSE (auth, network, bad response)."""


class SentinelClient:
    def __init__(self, client_id: Optional[str], client_secret: Optional[str], timeout: float = 90.0):
        self._id = client_id
        self._secret = client_secret
        self._timeout = timeout
        self._token: Optional[str] = None
        self._exp = 0.0

    @property
    def configured(self) -> bool:
        return bool(self._id and self._secret)

    # -- auth ---------------------------------------------------------------
    def _bearer(self) -> str:
        if not self.configured:
            raise SentinelError("Sentinel Hub credentials are not configured (SH_CLIENT_ID/SH_CLIENT_SECRET).")
        if self._token and time.time() < self._exp - 60:
            return self._token
        try:
            r = httpx.post(
                TOKEN_URL,
                data={"grant_type": "client_credentials", "client_id": self._id, "client_secret": self._secret},
                timeout=30,
            )
        except httpx.HTTPError as exc:
            raise SentinelError(f"token request failed ({type(exc).__name__})")
        if r.status_code != 200:
            raise SentinelError(f"authentication failed (HTTP {r.status_code}); check SH_CLIENT_ID/SH_CLIENT_SECRET.")
        j = r.json()
        self._token = j["access_token"]
        self._exp = time.time() + float(j.get("expires_in", 3600))
        return self._token

    # -- statistical API ----------------------------------------------------
    def statistics(self, geometry: dict, start: str, end: str, index: str, max_cloud: int = 60) -> list[dict]:
        """Per-acquisition stats for a polygon over [start, end] (YYYY-MM-DD).
        Returns [{date, mean, stdev, valid_fraction}] for intervals with data."""
        token = self._bearer()
        body = {
            "input": {
                "bounds": {"geometry": geometry, "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"}},
                "data": [{"type": COLLECTION, "dataFilter": {"maxCloudCoverage": max_cloud}}],
            },
            "aggregation": {
                "timeRange": {"from": f"{start}T00:00:00Z", "to": f"{end}T23:59:59Z"},
                "aggregationInterval": {"of": "P1D"},
                "evalscript": evalscript(index),
                "resx": 10,
                "resy": 10,
            },
        }
        try:
            r = httpx.post(STATS_URL, json=body, headers={"Authorization": f"Bearer {token}"}, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise SentinelError(f"statistics request failed ({type(exc).__name__})")
        if r.status_code != 200:
            raise SentinelError(f"statistics request failed (HTTP {r.status_code}): {r.text[:200]}")
        return _parse_statistics(r.json())

    # -- process API (colorized PNG; Stage 3) -------------------------------
    def index_png(self, geometry: dict, bbox: list[float], index: str, date: Optional[str], size: int = 512) -> bytes:
        from .sentinel_image import build_process_request  # local import keeps this file focused

        token = self._bearer()
        body = build_process_request(geometry, bbox, index, date, size)
        try:
            r = httpx.post(
                PROCESS_URL, json=body,
                headers={"Authorization": f"Bearer {token}", "Accept": "image/png"},
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise SentinelError(f"process request failed ({type(exc).__name__})")
        if r.status_code != 200:
            raise SentinelError(f"process request failed (HTTP {r.status_code}): {r.text[:200]}")
        return r.content


def _parse_statistics(payload: dict) -> list[dict]:
    """Map the SH Statistical API response to [{date, mean, stdev, valid_fraction}].

    Per interval, the `index` output's stats include sampleCount (pixels sampled)
    and noDataCount (pixels masked by dataMask); valid_fraction = valid/total."""
    out: list[dict] = []
    for item in payload.get("data", []):
        if item.get("error"):
            continue
        date = (item.get("interval", {}).get("from") or "")[:10]
        bands = item.get("outputs", {}).get("index", {}).get("bands", {})
        stats = (bands.get("B0") or next(iter(bands.values()), {})).get("stats", {})
        sample = stats.get("sampleCount") or 0
        nodata = stats.get("noDataCount") or 0
        valid = sample - nodata
        mean = stats.get("mean")
        if not date or sample <= 0 or valid <= 0 or mean is None:
            continue
        out.append({
            "date": date,
            "mean": float(mean),
            "stdev": float(stats.get("stDev") or 0.0),
            "valid_fraction": valid / sample,
        })
    out.sort(key=lambda p: p["date"])
    return out
