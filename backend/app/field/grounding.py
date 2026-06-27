"""Shared numeric grounding for the AI field features (summary + chat).

Isolated: imports only ..config (none needed here) + this package. Assembles the
ONE numeric block both the summary and the chat ground on — index trend, OpenET
ET gap (graceful when unavailable), and the engine context supplied by the
frontend. Nothing here invents or recomputes a value; it only reads this field's
caches and the numbers passed in.
"""
from __future__ import annotations

from typing import Optional

from . import indices, openet
from .schemas import EngineContext, Field


def index_trend(field: Field, index: str, start: str, end: str) -> dict:
    """Latest value, Δ over the last few obs, within-field σ, and anomaly dates —
    all from this field's cached index series. Graceful when cloud-masked/empty."""
    try:
        points, last_obs, note = indices.get_index_series(field, index, start, end)
    except Exception:
        points, last_obs, note = [], None, "unavailable"
    if not points:
        return {"available": False, "note": note or "no cloud-free imagery"}
    vals = [p["mean"] for p in points]
    last_n = min(5, len(vals))
    change = round(vals[-1] - vals[-last_n], 3)
    sigma = round(sum(p["stdev"] for p in points) / len(points), 3)
    # anomaly = drop > delta vs the prior valid obs
    delta = 0.07 if index.upper() == "NDRE" else 0.1
    anomalies = [points[i]["date"] for i in range(1, len(points))
                 if points[i - 1]["mean"] - points[i]["mean"] > delta]
    return {
        "available": True, "index": index.upper(), "latest": round(vals[-1], 3),
        "last_observation": last_obs, "change_over_last_n": change, "n_obs": last_n,
        "within_field_sigma": sigma, "n_cloud_free": len(points),
        "anomaly_dates": anomalies[-3:],
    }


def et_gap(field: Field, start: str, end: str, modeled_etc_cum_mm: Optional[float]) -> dict:
    """OpenET actual-ET cumulative vs the modeled cumulative ETc. Graceful when
    OpenET is unavailable/out-of-coverage."""
    try:
        et = openet.get_et(field, start, end)
    except Exception:
        et = {"et_actual": [], "coverage": "ok", "note": "unavailable"}
    actual = et.get("et_actual") or []
    if not actual:
        return {"available": False, "note": et.get("note") or "OpenET actual ET not available"}
    actual_cum = round(sum(p["mm"] for p in actual), 1)
    gap_pct = None
    if modeled_etc_cum_mm:
        gap_pct = round((modeled_etc_cum_mm - actual_cum) / modeled_etc_cum_mm * 100, 1)
    return {"available": True, "actual_et_cum_mm": actual_cum,
            "modeled_etc_cum_mm": modeled_etc_cum_mm, "gap_pct_below_modeled": gap_pct}


def numeric_block(field: Field, range_: dict, index: str, ec: EngineContext) -> tuple[dict, dict, dict]:
    """The single grounding block both summary and chat use. Returns
    (block, idx_trend, et_gap) so callers can also fingerprint on the parts."""
    start = range_.get("start", "")
    end = range_.get("end", "")
    idx = index_trend(field, index, start, end) if start and end else {"available": False}
    et = et_gap(field, start, end, ec.modeled_etc_cum_mm) if start and end else {"available": False}
    block = {
        "field": {"name": field.name, "acres": field.area_acres, "crop": field.crop},
        "date_range": range_,
        "growth_stage": ec.stage, "days_after_planting": ec.dap,
        "root_zone": {"depletion_mm": ec.depletion_mm, "allowable_depletion_mm": ec.ad_mm,
                      "headroom_mm": ec.headroom_mm},
        "engine_irrigation_decision": ec.decision,
        "modeled_cumulative_ETc_mm": ec.modeled_etc_cum_mm,
        "vegetation_index": idx,
        "openet_actual_ET": et,
    }
    return block, idx, et
