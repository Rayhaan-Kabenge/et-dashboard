"""Per-zone risk assembly — corn covered, sorghum gracefully pending (no misapply)."""
from __future__ import annotations

from app.farm import risk
from app.farm.schemas import Zone


def _zone(crop: str) -> Zone:
    return Zone(id=f"zone-{crop}", name=crop.title(), crop=crop, sheet_id="S", season_year=2026)


def test_corn_zone_gets_full_posteriors():
    r = risk.risk_for_zone(_zone("corn"))
    assert r.status == "ok"
    assert r.model_crop == "corn"
    assert r.metrics and "Yield" in r.metrics and "Profit" in r.metrics
    # three-zone structure with honest observation counts
    assert set(r.zone_observations) == {"Below", "Target", "Above"}
    assert r.zone_observations["Above"] < r.zone_observations["Below"]
    assert r.caveats  # surfaced
    # each metric carries by-zone skew-normal params
    y = r.metrics["Yield"]["by_zone"]
    assert set(y) == {"Below", "Target", "Above"}
    assert {"mu", "sigma", "alpha"} <= set(y["Target"])


def test_sorghum_zone_is_pending_not_corn_misapplied():
    r = risk.risk_for_zone(_zone("sorghum"))
    assert r.status == "unavailable"
    assert r.metrics is None                      # corn posteriors NOT applied to sorghum
    assert "sorghum" in r.message.lower()
    assert "corn" in (r.model_crop or "").lower()


def test_by_crop_shape_supported_without_code_change(monkeypatch):
    # a future JSON keyed by crop resolves per-crop with no code change
    fake = {
        "ratio_basis": "applied ÷ recommended",
        "by_crop": {
            "corn": {"metrics": {"Yield": {"by_zone": {}}}, "zone_observations": {}},
            "sorghum": {"metrics": {"Profit": {"by_zone": {}}}, "zone_observations": {}},
        },
    }
    monkeypatch.setattr(risk, "load_doc", lambda: fake)
    assert risk.risk_for_zone(_zone("sorghum")).status == "ok"
    assert risk.risk_for_zone(_zone("corn")).status == "ok"
    assert risk.risk_for_zone(_zone("wheat")).status == "unavailable"
