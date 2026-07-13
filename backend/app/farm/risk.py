"""Serve the pre-computed Bayesian risk posteriors for a zone, gated by crop.

Read-only assembly: this loads backend/app/field/data/risk_posteriors.json and
returns the relevant posteriors for the ACTIVE ZONE's crop. It computes nothing —
the skew-normal μ/σ/α and credible intervals were fit offline. The ET engine and
the window-band math are not involved.

Crop coverage is data-driven so a new crop needs only a JSON entry, no code change:
  - flat doc (current)  → treated as one model for `model_crop` (default "corn").
  - {"by_crop": {...}}   → a map of crop → model; add "sorghum" there later.
A zone whose crop isn't covered gets status="unavailable" (never corn posteriors
mis-applied to another crop).
"""
from __future__ import annotations

import json
from pathlib import Path

from .schemas import RiskResponse, Zone

# The risk JSON currently lives under the field-health data dir (committed there);
# this is a plain data-file read, not a code dependency on that package.
RISK_JSON = Path(__file__).resolve().parents[1] / "field" / "data" / "risk_posteriors.json"
DEFAULT_MODEL_CROP = "corn"


def load_doc() -> dict:
    return json.loads(RISK_JSON.read_text(encoding="utf-8"))


def _models_by_crop(doc: dict) -> dict[str, dict]:
    """Map crop → posterior model. Supports the flat single-crop doc (current) and
    a future {"by_crop": {crop: model}} shape with no code change."""
    by = doc.get("by_crop")
    if isinstance(by, dict) and by:
        return {str(k).strip().lower(): v for k, v in by.items()}
    model_crop = str(doc.get("model_crop") or doc.get("crop") or DEFAULT_MODEL_CROP).strip().lower()
    return {model_crop: doc}


def risk_for_zone(zone: Zone) -> RiskResponse:
    crop = (zone.crop or "").strip().lower()
    try:
        doc = load_doc()
    except (OSError, json.JSONDecodeError) as exc:  # missing / malformed → graceful
        return RiskResponse(status="unavailable", zone_id=zone.id, zone_crop=zone.crop,
                            zone_name=zone.name,
                            message=f"Risk model data unavailable ({type(exc).__name__}).")

    models = _models_by_crop(doc)
    covered_label = ", ".join(sorted(models))

    if crop not in models:
        return RiskResponse(
            status="unavailable", zone_id=zone.id, zone_crop=zone.crop, zone_name=zone.name,
            model_crop=covered_label, ratio_basis=doc.get("ratio_basis"),
            caveats=doc.get("caveats", []), source=doc.get("source"),
            message=(f"Risk model not yet available for {zone.crop} — analysis pending. "
                     f"The current Bayesian posterior is {covered_label}-only."),
        )

    model = models[crop]
    return RiskResponse(
        status="ok", zone_id=zone.id, zone_crop=zone.crop, zone_name=zone.name,
        model_crop=crop,
        ratio_basis=model.get("ratio_basis", doc.get("ratio_basis")),
        distribution=model.get("distribution", doc.get("distribution")),
        zone_bands=model.get("zone_bands", doc.get("zone_bands")),
        zone_observations=model.get("zone_observations", doc.get("zone_observations")),
        metric_display_order=model.get("metric_display_order", doc.get("metric_display_order")),
        metrics=model.get("metrics", doc.get("metrics")),
        caveats=model.get("caveats", doc.get("caveats", [])),
        source=model.get("source", doc.get("source")),
    )
