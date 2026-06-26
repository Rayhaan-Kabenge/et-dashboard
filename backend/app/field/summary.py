"""AI field-summary (v2) — Claude narrates the already-computed numbers.

Isolated: imports only ..config + this package. The engine-side numbers arrive in
the request (from the frontend's /api/state); the index trend and ET gap come from
this field's own caches. Claude only EXPLAINS the supplied numbers — it never
computes or invents any value, and never overrides the engine's decision.

Result is cached by an input fingerprint (range + last imagery + depletion +
decision + ET gap) so we don't pay per page-load. Graceful empty state if
ANTHROPIC_API_KEY is missing or the call fails.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Optional

from ..config import get_settings
from . import field_store, indices, openet
from .schemas import Field, SummaryRequest, SummaryResponse

MODEL = "claude-haiku-4-5-20251001"

SYSTEM_PROMPT = (
    "You are an agronomy assistant writing a short, plain-language field-health note "
    "for a grower/agronomist. STRICT RULES:\n"
    "- Use ONLY the numbers provided in the message. Never invent, estimate, extrapolate, "
    "or recompute any figure. If a value is missing, say it's not available.\n"
    "- This note is advisory and explanatory ONLY. The irrigation recommendation comes from "
    "the model's decision (given to you) — restate it faithfully and NEVER contradict, "
    "override, or second-guess it.\n"
    "- Be concise (3-5 sentences, one short paragraph), concrete, and reference the actual "
    "numbers. Honestly flag uncertainty: cloud gaps in imagery, provisional/missing ET.\n"
    "- No preamble, no headings, no markdown — just the paragraph."
)


# --------------------------------------------------------------------------- #
# context assembly (all from already-computed values)
# --------------------------------------------------------------------------- #
def _index_trend(field: Field, index: str, start: str, end: str) -> dict:
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
    anomalies = [points[i]["date"] for i in range(1, len(points)) if points[i - 1]["mean"] - points[i]["mean"] > delta]
    return {
        "available": True, "index": index.upper(), "latest": round(vals[-1], 3),
        "last_observation": last_obs, "change_over_last_n": change, "n_obs": last_n,
        "within_field_sigma": sigma, "n_cloud_free": len(points),
        "anomaly_dates": anomalies[-3:],
    }


def _et_gap(field: Field, start: str, end: str, modeled_etc_cum_mm: Optional[float]) -> dict:
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


def _context_block(field: Field, req: SummaryRequest, idx: dict, et: dict) -> str:
    ec = req.engine_context
    block = {
        "field": {"name": field.name, "acres": field.area_acres, "crop": field.crop},
        "date_range": req.range,
        "growth_stage": ec.stage, "days_after_planting": ec.dap,
        "root_zone": {"depletion_mm": ec.depletion_mm, "allowable_depletion_mm": ec.ad_mm,
                      "headroom_mm": ec.headroom_mm},
        "engine_irrigation_decision": ec.decision,
        "modeled_cumulative_ETc_mm": ec.modeled_etc_cum_mm,
        "vegetation_index": idx,
        "openet_actual_ET": et,
    }
    return (
        "Summarize the health of this field for the grower using ONLY these numbers:\n\n"
        + json.dumps(block, indent=2)
    )


def _fingerprint(req: SummaryRequest, idx: dict, et: dict) -> str:
    key = json.dumps({
        "range": req.range, "index": req.index,
        "last_obs": idx.get("last_observation"), "latest": idx.get("latest"),
        "depletion": req.engine_context.depletion_mm, "decision": req.engine_context.decision,
        "gap": et.get("gap_pct_below_modeled"), "etc": req.engine_context.modeled_etc_cum_mm,
    }, sort_keys=True)
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def _cache_file(field_id: str):
    return field_store.cache_path(field_id, "summary.json")


def _load_cache(field_id: str) -> Optional[dict]:
    p = _cache_file(field_id)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return None


def _save_cache(field_id: str, data: dict) -> None:
    try:
        _cache_file(field_id).write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        pass


# --------------------------------------------------------------------------- #
def build_summary(field: Field, req: SummaryRequest, force: bool = False) -> SummaryResponse:
    start = req.range.get("start", "")
    end = req.range.get("end", "")
    idx = _index_trend(field, req.index, start, end) if start and end else {"available": False}
    et = _et_gap(field, start, end, req.engine_context.modeled_etc_cum_mm) if start and end else {"available": False}
    fingerprint = _fingerprint(req, idx, et)

    cached = _load_cache(field.id)
    if not force and cached and cached.get("fingerprint") == fingerprint and cached.get("text"):
        return SummaryResponse(status="ok", summary_text=cached["text"], generated_at=cached["generated_at"],
                               model=cached["model"], inputs_fingerprint=fingerprint)

    settings = get_settings()
    if not settings.anthropic_api_key:
        return SummaryResponse(status="unconfigured",
                               message="Add an ANTHROPIC_API_KEY to enable the AI summary.")

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = client.messages.create(
            model=MODEL, max_tokens=400, temperature=0.2,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": _context_block(field, req, idx, et)}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    except Exception as exc:  # network / SDK / auth — never error the page
        return SummaryResponse(status="error", message=f"Summary unavailable ({type(exc).__name__}).")

    generated_at = datetime.now(timezone.utc).isoformat()
    _save_cache(field.id, {"fingerprint": fingerprint, "text": text, "generated_at": generated_at, "model": MODEL})
    return SummaryResponse(status="ok", summary_text=text, generated_at=generated_at,
                           model=MODEL, inputs_fingerprint=fingerprint)
