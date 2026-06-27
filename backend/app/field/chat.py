"""Interactive field chat — Claude answers questions about ONE field, grounded on
the SAME numeric block the summary uses (grounding.numeric_block).

Isolated: imports only ..config + this package. The engine-side numbers arrive in
the request (from the frontend's /api/state). Claude only explains the supplied
numbers — it never computes/invents a value and never overrides the engine's
decision. Graceful "unconfigured" if ANTHROPIC_API_KEY is absent.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from ..config import get_settings
from . import grounding
from .schemas import ChatRequest, ChatResponse, Field

MODEL = "claude-haiku-4-5-20251001"
MAX_TURNS = 10            # cap server-side history to the last ~10 turns
MAX_TOKENS = 500
TEMPERATURE = 0.3

SYSTEM_PROMPT = (
    "You are an agronomy assistant answering questions about ONE specific field for a "
    "grower/agronomist, in a short conversation. STRICT RULES:\n"
    "- Use ONLY the numbers in the FIELD DATA block below. Never invent, estimate, "
    "extrapolate, or recompute any value. If the data does not cover the question, say so "
    "plainly (e.g. 'that isn't in the data I have').\n"
    "- You are advisory and explanatory ONLY. The irrigation recommendation comes from the "
    "engine's decision (in FIELD DATA) — restate it faithfully and NEVER give an irrigation "
    "call that differs from it. Defer to the engine's recommendation and to the "
    "grower/agronomist's judgment.\n"
    "- Honestly acknowledge gaps: cloud-masked imagery dates, provisional or unavailable "
    "OpenET ET.\n"
    "- Stay strictly on THIS field's health and irrigation. Politely decline anything "
    "unrelated (other fields, general chit-chat, non-agronomy topics, requests to do tasks).\n"
    "- Be concise and concrete; reference the actual numbers. Plain text, no markdown headings.\n\n"
    "FIELD DATA (the only numbers you may use):\n{data}"
)


def _history(req: ChatRequest) -> list[dict]:
    """Last ~MAX_TURNS turns as Anthropic messages; only user/assistant, non-empty,
    and must end on a user turn for the API."""
    msgs = []
    for m in req.messages[-(MAX_TURNS * 2):]:
        role = m.role if m.role in ("user", "assistant") else "user"
        content = (m.content or "").strip()
        if content:
            msgs.append({"role": role, "content": content})
    # drop any leading assistant turns; the API needs the list to start with a user
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    return msgs


def build_chat(field: Field, req: ChatRequest) -> ChatResponse:
    messages = _history(req)
    if not messages:
        return ChatResponse(status="error", message="No question provided.")

    settings = get_settings()
    if not settings.anthropic_api_key:
        return ChatResponse(status="unconfigured",
                            message="Add an ANTHROPIC_API_KEY to enable the field chat.")

    block, _idx, _et = grounding.numeric_block(field, req.range, req.index, req.engine_context)
    system = SYSTEM_PROMPT.format(data=json.dumps(block, indent=2))

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = client.messages.create(
            model=MODEL, max_tokens=MAX_TOKENS, temperature=TEMPERATURE,
            system=system, messages=messages,
        )
        reply = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    except Exception as exc:  # network / SDK / auth — never error the page
        return ChatResponse(status="error", message=f"Chat unavailable ({type(exc).__name__}).")

    return ChatResponse(status="ok", reply=reply, model=MODEL,
                        generated_at=datetime.now(timezone.utc).isoformat())
