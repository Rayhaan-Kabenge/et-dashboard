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
from . import field_store, grounding
from .schemas import Field, SiSummaryRequest, SummaryRequest, SummaryResponse

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
# context assembly — shared with chat via grounding.numeric_block
# --------------------------------------------------------------------------- #
def _context_block(block: dict) -> str:
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


def _cache_file(field_id: str, name: str = "summary.json"):
    return field_store.cache_path(field_id, name)


def _load_cache(field_id: str, name: str = "summary.json") -> Optional[dict]:
    p = _cache_file(field_id, name)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return None


def _save_cache(field_id: str, data: dict, name: str = "summary.json") -> None:
    try:
        _cache_file(field_id, name).write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        pass


def _call_claude(system: str, user_content: str, max_tokens: int, temperature: float) -> str:
    """One guarded Anthropic call shared by both summaries. Raises on failure."""
    import anthropic
    client = anthropic.Anthropic(api_key=get_settings().anthropic_api_key)
    msg = client.messages.create(
        model=MODEL, max_tokens=max_tokens, temperature=temperature,
        system=system, messages=[{"role": "user", "content": user_content}],
    )
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()


# --------------------------------------------------------------------------- #
def build_summary(field: Field, req: SummaryRequest, force: bool = False) -> SummaryResponse:
    block, idx, et = grounding.numeric_block(field, req.range, req.index, req.engine_context)
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
        text = _call_claude(SYSTEM_PROMPT, _context_block(block), max_tokens=400, temperature=0.2)
    except Exception as exc:  # network / SDK / auth — never error the page
        return SummaryResponse(status="error", message=f"Summary unavailable ({type(exc).__name__}).")

    generated_at = datetime.now(timezone.utc).isoformat()
    _save_cache(field.id, {"fingerprint": fingerprint, "text": text, "generated_at": generated_at, "model": MODEL})
    return SummaryResponse(status="ok", summary_text=text, generated_at=generated_at,
                           model=MODEL, inputs_fingerprint=fingerprint)


# --------------------------------------------------------------------------- #
# SI spatial summary — same JSON-grounded architecture, SI-specific guardrails
# --------------------------------------------------------------------------- #
SI_SYSTEM_PROMPT = (
    "You are an agronomy assistant writing a short spatial read of a Relative "
    "Sufficiency Index (SI) map for ONE field. SI = pixel NDRE ÷ an INTERNAL "
    "95th-percentile reference, over CROPPED pixels only (bare/unplanted ground is "
    "already excluded). STRICT RULES:\n"
    "- Describe ONLY the numbers provided. Never invent, estimate, or recompute SI "
    "values, percentages, or zones. If something is missing, say it's not available.\n"
    "- Frame everything as RELATIVE within-field sufficiency — zones to INVESTIGATE, "
    "never a nitrogen prescription or an N-rate. State that low-SI zones may reflect "
    "water, soil, or stand differences, not only nitrogen.\n"
    "- Give the direction of the low-SI zones from the provided location data "
    "(e.g. 'concentrated in the southwest', 'scattered').\n"
    "- Water cross-check, ONLY when root-zone data is present: if soil water is "
    "adequate (depletion comfortably below allowable), note that a nutrient or "
    "stand cause is more plausible; if soil water is low/near trigger, flag water "
    "first before reading the map as nutrient stress. Never contradict the engine's "
    "irrigation decision.\n"
    "- Always note the internal-reference caveat: this cannot detect whole-field "
    "deficiency, only spatial variability.\n"
    "- 3-5 sentences, plain language, reference the actual numbers. No headings, no markdown."
)


def _si_fingerprint(spatial: dict, req: SiSummaryRequest) -> str:
    key = json.dumps({
        "scene": spatial.get("scene_date"), "ref": spatial.get("reference_ndre"),
        "threshold": req.threshold, "pct": spatial.get("pct_of_cropped_area_below_threshold"),
        "cropped": spatial.get("cropped_fraction_of_field"),
        "depletion": req.engine_context.depletion_mm, "decision": req.engine_context.decision,
    }, sort_keys=True)
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def build_si_summary(field: Field, req: SiSummaryRequest, force: bool = False) -> SummaryResponse:
    """Spatial narration of the masked SI stats. Grounded on the SAME shared block
    (grounding.numeric_block) plus the SI spatial stats from sufficiency.spatial_stats.
    Graceful when SI is unavailable (bare / early / no scene) or no key."""
    from . import sufficiency
    from .sentinel import SentinelError

    start = req.range.get("start", "")
    end = req.range.get("end", "")
    if not start or not end:
        return SummaryResponse(status="unavailable", message="No date range selected.")
    try:
        spatial = sufficiency.spatial_stats(field, start, end, req.threshold)
    except sufficiency.SufficiencyUnavailable as exc:
        return SummaryResponse(status="unavailable", message=exc.reason)
    except SentinelError as exc:
        return SummaryResponse(status="unavailable", message=str(exc))

    # shared grounding block (field, root zone, engine decision, index trend, ET)
    block, _idx, _et = grounding.numeric_block(field, req.range, "NDRE", req.engine_context)
    block["relative_sufficiency_SI"] = spatial

    fingerprint = _si_fingerprint(spatial, req)
    cached = _load_cache(field.id, "si_summary.json")
    if not force and cached and cached.get("fingerprint") == fingerprint and cached.get("text"):
        return SummaryResponse(status="ok", summary_text=cached["text"], generated_at=cached["generated_at"],
                               model=cached["model"], inputs_fingerprint=fingerprint)

    if not get_settings().anthropic_api_key:
        return SummaryResponse(status="unconfigured",
                               message="Add an ANTHROPIC_API_KEY to enable the AI summary.")
    try:
        user = ("Describe the spatial sufficiency pattern of this field for the grower "
                "using ONLY these numbers:\n\n" + json.dumps(block, indent=2))
        text = _call_claude(SI_SYSTEM_PROMPT, user, max_tokens=400, temperature=0.3)
    except Exception as exc:  # network / SDK / auth — never error the page
        return SummaryResponse(status="error", message=f"Summary unavailable ({type(exc).__name__}).")

    generated_at = datetime.now(timezone.utc).isoformat()
    _save_cache(field.id, {"fingerprint": fingerprint, "text": text, "generated_at": generated_at,
                           "model": MODEL}, "si_summary.json")
    return SummaryResponse(status="ok", summary_text=text, generated_at=generated_at,
                           model=MODEL, inputs_fingerprint=fingerprint)
