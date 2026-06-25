"""Loader fidelity, ETr sanity, live open-interval estimation, and API-shape tests
(acceptance criteria 2-4 plus the provisional-stage feature).

These run offline: the forecast tail (Open-Meteo) is forced to persistence so the
suite is deterministic and needs no network.
"""
import pytest

from conftest import SAMPLE_DIR
from app.compute import build_state, run_engine, build_engine_stages
from app.config import Settings
from app.sheets import CsvSheetSource, LocalFetcher
from pyfao56 import refet

DEMO = Settings(sheet_id="demo", lon=None)


def _load():
    # longitude=None -> fabricate_forecast uses persistence (no network)
    inp = CsvSheetSource(LocalFetcher(SAMPLE_DIR), longitude=None).load()
    cr = run_engine(inp, DEMO)
    return inp, cr


# --- criterion 2: loader fidelity ------------------------------------------
def test_loader_reproduces_known_scenario():
    """Sheet -> engine inputs -> (provisional stages + persistence forecast) -> run
    reproduces a hand-checked depletion/decision. Deterministic offline."""
    inp, cr = _load()
    by = {r["date"].isoformat(): r for r in cr.rows}

    r22 = by["2026-06-22"]                 # depletion crosses AD on a scheduled Irrig day
    assert r22["should_irrigate"] is True
    assert r22["applied"] == 25.0
    assert r22["depletion"] == pytest.approx(42.451603, abs=1e-4)
    assert r22["ad"] == pytest.approx(41.25, abs=1e-9)

    r24 = by["2026-06-24"]                 # post-irrigation, below trigger
    assert r24["should_irrigate"] is False
    assert r24["depletion"] == pytest.approx(27.543403, abs=1e-4)


def test_loader_inputs_structure():
    inp = CsvSheetSource(LocalFetcher(SAMPLE_DIR), longitude=None).load()
    assert inp.site.season == 2026
    assert inp.config.wndht == 2.0
    assert inp.config.tall is True                         # Reference crop = Tall
    assert inp.stages[0].date == inp.site.planting_date    # earliest observed = planting
    assert inp.stages == sorted(inp.stages, key=lambda s: s.date)
    assert inp.stages[0].managed_depth is None             # early stage: no trigger
    assert len(inp.soil_layers) == 4
    # undated future stages exist and carry an Avg-days-to-next + the terminal marker
    future = [sr for sr in inp.stage_rows if sr.date is None]
    assert len(future) >= 1
    assert inp.stage_rows[-1].label == "Maturity"
    assert inp.stage_rows[-1].managed_depth is None and inp.stage_rows[-1].mad is None
    v12 = next(sr for sr in inp.stage_rows if sr.label == "V12")
    assert v12.avg_days_to_next == 21


# --- live open-interval estimation -----------------------------------------
def test_open_interval_provisional_gives_today_a_value():
    """The current (open) stage has no observed end, yet today's Kcr/ETc exist
    because a provisional next-stage date is placed in input-prep."""
    inp, cr = _load()
    last_actual = inp.weather[-1]["date"]
    es, cur, prov = build_engine_stages(inp, last_actual, DEMO.forecast_horizon_days)
    assert cur is not None and len(prov) >= 1                # a provisional date was placed
    assert es[-1].label in prov                              # last engine stage is provisional

    today_row = cr.actual_rows[-1]
    assert today_row["kcr"] is not None                     # the whole point: no NA today
    assert today_row["depletion"] is not None
    assert cr.kind_for(cr.n_actual - 1, today_row["date"]) == "provisional"


# --- criterion 3: ETr sanity ------------------------------------------------
def test_etr_matches_asce_reference():
    """Engine etr (via its pyfao wrapper) matches a direct ASCE-2005 call < 0.01."""
    inp, cr = _load()
    w = inp.weather[20]
    direct = refet.ascedaily(
        rfcrp="T", z=inp.config.elev, lat=inp.config.lat, doy=w["doy"],
        israd=w["rs"], tmax=w["tmax"], tmin=w["tmin"],
        rhmax=w["rhmax"], rhmin=w["rhmin"], wndsp=w["u"], wndht=inp.config.wndht)
    assert abs(cr.rows[20]["etr"] - direct) < 0.01


# --- criterion 4: API shape -------------------------------------------------
def test_state_payload_shape(monkeypatch):
    """build_state validates against the schema; forecast flagged; decision
    consistent with the series."""
    import app.compute as C
    from app.weather import fabricate_forecast as real_fab

    def offline_fab(actuals, **kw):
        kw["lat"] = None  # force the persistence fallback (no network)
        kw["lon"] = None
        return real_fab(actuals, **kw)

    monkeypatch.setattr(C, "fabricate_forecast", offline_fab)

    st = build_state(DEMO)
    assert st.today is not None and st.decision is not None and st.growth_stage is not None
    assert len(st.series) > 0

    forecast_pts = [p for p in st.series if p.is_forecast]
    assert len(forecast_pts) == DEMO.forecast_horizon_days
    assert all(p.kind == "forecast" for p in forecast_pts)
    assert st.freshness.forecast_source == "persistence"

    # every series point carries a kind; flags are contiguous (actuals then forecast)
    assert {p.kind for p in st.series} <= {"observed", "provisional", "forecast"}
    flags = [p.is_forecast for p in st.series]
    assert flags == sorted(flags)

    if st.decision.days_to_trigger is not None:
        assert st.decision.days_to_trigger >= 0
    if st.decision.projected_trigger_date is not None:
        match = [p for p in st.series if p.date == st.decision.projected_trigger_date]
        assert match and match[0].is_forecast
        assert match[0].depletion is not None and match[0].ad is not None
        assert match[0].depletion >= match[0].ad


def test_units_default_is_metric():
    inp = CsvSheetSource(LocalFetcher(SAMPLE_DIR), longitude=None).load()
    assert inp.site.units_default == "mm"
