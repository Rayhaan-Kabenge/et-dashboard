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
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = client.messages.create(
            model=MODEL, max_tokens=400, temperature=0.2,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": _context_block(block)}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    except Exception as exc:  # network / SDK / auth — never error the page
        return SummaryResponse(status="error", message=f"Summary unavailable ({type(exc).__name__}).")

    generated_at = datetime.now(timezone.utc).isoformat()
    _save_cache(field.id, {"fingerprint": fingerprint, "text": text, "generated_at": generated_at, "model": MODEL})
    return SummaryResponse(status="ok", summary_text=text, generated_at=generated_at,
                           model=MODEL, inputs_fingerprint=fingerprint)
