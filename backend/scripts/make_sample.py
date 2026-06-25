"""Generate the bundled demo sheet (5 CSV tabs) for a realistic 2026 corn season.

Deterministic (seeded). Produces files under app/sample_sheet/ matching the exact
tab/column names of the real template. Run:  python scripts/make_sample.py
"""
import csv
import math
import random
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "app" / "sample_sheet"
OUT.mkdir(parents=True, exist_ok=True)

SEASON = 2026
PLANT = date(2026, 5, 1)
LAST_ACTUAL = date(2026, 6, 24)   # forecast fills 6/25-6/27; "today" is 6/25
LAT, LON, ELEV = 39.18, -96.57, 320.0   # Manhattan, KS-ish

rng = random.Random(42)


def write_csv(name, header, rows):
    with open(OUT / f"{name}.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


# ---- Site_Config -----------------------------------------------------------
site_rows = [
    ["Site name", "Schudel Farm — North Pivot", ""],
    ["Season (year)", SEASON, ""],
    ["Latitude", LAT, "decimal degrees"],
    ["Elevation", ELEV, "m"],
    ["Reference crop", "Tall", "Tall|Short (alfalfa ETr)"],
    ["Wind height", 2, "m (expect 2; input wind is u2)"],
    ["Planting date", PLANT.isoformat(), ""],
    ["Curve Number (CN)", 78, "SCS runoff curve number"],
    ["Initial depletion", 0, "mm at planting"],
    ["Irrigation depth", 25, "mm per scheduled Irrig event"],
    ["Fertigation depth", 15, "mm per scheduled Fert event"],
    ["Humidity input type", "RHmax_RHmin", "RHmax_RHmin|Dewpoint|VaporPressure"],
]
write_csv("Site_Config", ["Field", "Value", "Notes"], site_rows)

# ---- Soil_AWC --------------------------------------------------------------
soil = [
    ["L1", 0, 150, 0.18],
    ["L2", 150, 300, 0.17],
    ["L3", 300, 600, 0.15],
    ["L4", 600, 900, 0.13],
]
write_csv("Soil_AWC", ["Layer", "Top (mm)", "Bottom (mm)", "AWC (mm/mm)"], soil)

# ---- Crop_Stages -----------------------------------------------------------
# slope/intercept map Kcr across each interval's GDD fraction (0..1). Stages up to
# the current one are OBSERVED (dated); later stages are UNDATED (future) with a
# calibration + "Avg days to next" so the live open-interval estimator can place
# provisional dates. (Avg days to next on the latest observed stage drives the
# current open interval.) Last row (Maturity) is the terminal marker.
stages = [
    # label,    date observed,        slope, intercept, Zr,  MAD,  avg days to next
    ["VE",       date(2026, 5, 1),     0.00, 0.10, "",  "",   21],
    ["V6",       date(2026, 5, 22),    0.30, 0.10, 300, 0.50, 23],
    ["V12",      date(2026, 6, 14),    0.50, 0.40, 500, 0.50, 21],  # current (open) stage
    ["VT/R1",    None,                 0.10, 0.90, 700, 0.55, 31],  # future (estimated)
    ["R4",       None,                -0.30, 1.00, 900, 0.60, 46],  # future (estimated)
    ["Maturity", None,                 0.00, 0.00, "",  "",   ""],  # terminal marker
]
write_csv("Crop_Stages",
          ["Stage", "Date observed", "Kcr slope", "Kcr intercept",
           "Managed depth Zr (mm)", "MAD (fraction)", "Avg days to next"],
          [[s[0], (s[1].isoformat() if s[1] else ""), s[2], s[3], s[4], s[5], s[6]] for s in stages])

# ---- Weather_Daily ---------------------------------------------------------
# Seasonal warming trend + day-to-day noise; a few rain events.
rain_days = {date(2026, 5, 9): 14.0, date(2026, 5, 24): 22.0,
             date(2026, 6, 3): 9.0, date(2026, 6, 16): 17.0}
weather_rows = []
d = PLANT
while d <= LAST_ACTUAL:
    dap = (d - PLANT).days
    seasonal = 26 + 7 * math.sin((dap - 30) / 60.0 * math.pi)   # warming into summer
    tmax = round(seasonal + rng.uniform(-3, 4), 1)
    tmin = round(seasonal - 11 + rng.uniform(-2.5, 2.5), 1)
    rhmax = round(min(96, 78 + rng.uniform(-6, 12)), 0)
    rhmin = round(max(22, 38 + rng.uniform(-10, 8)), 0)
    u2 = round(max(0.8, 2.4 + rng.uniform(-1.0, 1.6)), 1)
    rs = round(max(8.0, 24 + 4 * math.sin((dap - 30) / 60.0 * math.pi) + rng.uniform(-4, 3)), 1)
    precip = rain_days.get(d, 0.0)
    weather_rows.append([d.isoformat(), tmin, tmax, rhmin, rhmax, u2, rs, precip])
    d += timedelta(days=1)
write_csv("Weather_Daily",
          ["Date", "Tmin (°C)", "Tmax (°C)", "RHmin (%)", "RHmax (%)",
           "U2 (m/s)", "Rs (MJ/m²/d)", "Precip (mm)"],
          weather_rows)

# ---- Irrigation_Schedule ---------------------------------------------------
# Candidate irrigation days available twice weekly once roots establish; a couple
# of fertigation events. The engine only "applies" when the trigger is hit.
sched_rows = []
d = date(2026, 6, 1)
while d <= date(2026, 9, 15):
    if d.weekday() in (0, 3):  # Mon/Thu candidate irrigations
        sched_rows.append(["Irrig", d.isoformat()])
    d += timedelta(days=1)
for fd in (date(2026, 6, 9), date(2026, 7, 7)):
    sched_rows.append(["Fert", fd.isoformat()])
sched_rows.sort(key=lambda r: r[1])
write_csv("Irrigation_Schedule", ["Type", "Date"], sched_rows)

print(f"wrote sample sheet to {OUT}")
print(f"  weather: {len(weather_rows)} days ({PLANT} .. {LAST_ACTUAL})")
print(f"  schedule: {len(sched_rows)} candidate events")
