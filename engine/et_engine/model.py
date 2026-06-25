"""Daily ET water-balance — orchestrates the engine, mirroring the Excel
daily table exactly (Sections B-I). ETr is pluggable: computed via pyfao56
(production) or injected (validation / forecast)."""
from dataclasses import dataclass, field
from datetime import date
from typing import Optional
import math

from .gdd import gdd_stress
from .runoff import cn_storage, initial_abstraction, ro_cn
from .soil import allowable_depletion
from .refet import etr_daily


@dataclass
class Stage:
    date: date
    label: str
    slope: float          # a_m
    intercept: float      # b_m
    managed_depth: Optional[float]   # Zr_m (mm) or None
    mad: Optional[float]             # f_m or None


@dataclass
class Config:
    lat: float
    elev: float
    wndht: float
    cn: float
    irrig_depth: float
    fert_depth: float
    tall: bool = True
    dr0: float = 0.0      # initial depletion -> Z35 (D17)
    dp0: float = 0.0      # Y35 (C17)
    tu: float = 28.0
    tl: float = 10.0


def _isnum(x):
    return isinstance(x, (int, float)) and not (isinstance(x, float) and math.isnan(x))


def run(cfg: Config, soil_layers, stages, schedule, weather, etr_override=None):
    """weather: list of dict(date, doy, tmax, tmin, ea, rs, u, precip) in order.
    schedule: dict date -> 'Irrig'|'Fert'. etr_override: optional list of ETr."""
    n = len(weather)
    S = cn_storage(cfg.cn)
    Ia = initial_abstraction(S)

    # ---- pass 1: GDD and cumulative GDD ----
    gdd = [gdd_stress(w["tmax"], w["tmin"], cfg.tu, cfg.tl) for w in weather]
    cum = [0.0] * n
    for i in range(1, n):
        cum[i] = cum[i - 1] + gdd[i - 1]

    # ---- stage start GDD (G0_m); clamp a stage date with no weather row to the
    # last weather day on/before it (GDD=0 on blank days, so cum is unchanged) ----
    date_to_cum = {weather[i]["date"]: cum[i] for i in range(n)}
    ordered = [(weather[i]["date"], cum[i]) for i in range(n)]

    def cum_at(d):
        if d in date_to_cum:
            return date_to_cum[d]
        prior = [c for (wd, c) in ordered if wd <= d]
        return prior[-1] if prior else None

    g0 = [cum_at(s.date) for s in stages]
    dG = []
    for m in range(len(stages)):
        if m + 1 < len(stages) and g0[m + 1] is not None and g0[m] is not None:
            dG.append(g0[m + 1] - g0[m])
        else:
            dG.append(None)

    stage_dates = {s.date: i for i, s in enumerate(stages)}  # date -> interval idx (0-based)
    ad_by_interval = [allowable_depletion(s.managed_depth, s.mad, soil_layers) for s in stages]

    rows = []
    dr_prev = dp_prev = etc_prev = ro_prev = p_prev = applied_prev = None
    m_idx = 0  # 0-based current interval index (Excel M = m_idx+1)

    for i, w in enumerate(weather):
        # interval index: starts at 1 (m_idx 0) on planting day, +1 each stage date
        if i == 0:
            m_idx = 0
            stage_label = stages[0].label
        else:
            if w["date"] in stage_dates:
                m_idx += 1
            stage_label = stages[stage_dates[w["date"]]].label if w["date"] in stage_dates else ""

        # fracInt and Kcr
        st = stages[m_idx]
        denom = dG[m_idx]
        if denom in (None, 0):
            frac = None
            kcr = None
        else:
            frac = (cum[i] - g0[m_idx]) / denom
            kcr = st.slope * frac + st.intercept

        # ETr
        if etr_override is not None:
            etr = etr_override[i]
        else:
            etr = etr_daily(w["doy"], w["tmax"], w["tmin"], w["rs"], cfg.elev,
                            cfg.lat, w["u"], cfg.wndht, cfg.tall, vapr=w.get("ea", float("nan")))

        etc = kcr * etr if (kcr is not None and _isnum(etr)) else None
        ro = ro_cn(w["precip"], S, Ia)

        # water balance
        if i == 0:
            dp = cfg.dp0
            dr = cfg.dr0
        elif None in (dr_prev, dp_prev, etc_prev):
            dr = None; dp = None          # NA propagates, as in Excel
        else:
            dr = dr_prev - applied_prev + etc_prev - p_prev + ro_prev + dp_prev
            dp = max(-dr - etc, 0.0) if etc is not None else None

        ad = ad_by_interval[m_idx]
        should = (ad is not None) and _isnum(dr) and (dr > ad)
        # applied
        if w["date"] in schedule and should:
            typ = schedule[w["date"]]
            applied = cfg.irrig_depth if typ == "Irrig" else (cfg.fert_depth if typ == "Fert" else 0.0)
        else:
            applied = 0.0

        rows.append(dict(date=w["date"], doy=w["doy"], dap=i, gdd=gdd[i], cumgdd=cum[i],
                         stage=stage_label, interval=m_idx + 1, ro=ro, etr=etr,
                         fracint=frac, kcr=kcr, etc=etc, dp=dp, depletion=dr,
                         ad=ad, should_irrigate=should, applied=applied))
        dr_prev, dp_prev, etc_prev, ro_prev, p_prev, applied_prev = dr, dp, etc, ro, w["precip"], applied
    return rows
