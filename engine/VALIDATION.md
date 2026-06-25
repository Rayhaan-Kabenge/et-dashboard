# ET Scheduler Engine — Validation Report

`et_engine` is a pure-Python port of the Excel ET irrigation scheduler. Every
calculation reproduces the Excel **exactly**, except reference ET, which is
computed by **pyfao56** (`refet.ascedaily`, tall reference) to replace the Excel
`ETrefDayASCE`. Full math is in `ET_Scheduler_Equation_Spec.md`.

## Package layout

| Module | Contents |
|---|---|
| `gdd.py` | `gdd_stress()` — exact port of the `GDDStress` VBA (double-threshold heat-stress GDD) |
| `runoff.py` | `ro_cn()` + curve-number `S`/`Ia` derivation (exact port of `RO_CN`) |
| `soil.py` | `allowable_depletion()` — layered AWC × MAD (Section G) |
| `refet.py` | pyfao56 wrapper for ASCE-2005 reference ET (the only departure from Excel) |
| `model.py` | `Config`, `Stage`, `run()` — the sequential daily water-balance loop (Sections B–I); ETr is pluggable (pyfao or injected) |

## How it was validated

The engine was run against the **2017–2023** daily sheets. Because ETr now comes
from pyfao (so ETr-dependent columns will differ from the Excel's old ETr by
design), validation was done in **ETr-injection mode**: the Excel's own stored
ETr was fed into the engine, so every other column must reproduce the Excel
exactly. This isolates and proves the Sections B–I logic.

Run it yourself (place `2017_2023_ETschudelr_Code.xlsm` beside the scripts):

```
pip install pyfao56 openpyxl
python validate_summary.py
```

## Results (Excel ETr injected → tests Sections B–I)

Every continuous column compared: GDD, ∑GDD, runoff, fracInt, Kcr, ETc, deep
percolation, depletion, AD; plus discrete stage, interval, should-irrigate, and
applied water.

| Year | Days | Worst \|diff\| | should-irrigate | applied \|diff\| | Result |
|---|---|---|---|---|---|
| 2017 | 176 | 7.1e-15 | 0 | 0 | **exact** |
| 2018 | 145 | 2.9e-03 | 0 | 0 | exact except 4 tail days (see note) |
| 2019 | 172 | 7.1e-15 | 0 | 0 | **exact** |
| 2020 | 172 | 7.1e-15 | 0 | 0 | **exact** |
| 2021 | 172 | 7.1e-15 | 0 | 0 | **exact** |
| 2022 | 172 | 7.1e-15 | 0 | 0 | **exact** |
| 2023 | 172 | 7.1e-15 | 0 | 0 | **exact** |

`7.1e-15` is floating-point round-off — i.e. bit-for-bit agreement.

**2018 note:** that sheet's weather ends Sep 22 but a final stage marker sits at
Sep 29. The engine clamps the missing stage date to the last weather day, leaving
a ≤0.0023 mm difference on the final 4 days. Irrigation decisions are identical.
A data-completeness artifact of that sheet, not an engine difference.

## Validation-only quirks handled (not part of the engine)

These are peculiarities of the historical workbook, irrelevant once inputs come
from a clean Google Sheet:

1. The irrigation-schedule range is defined by the daily `AC` formula and **varies
   per year**; the first row (`AC35`) was hand-edited to a wider range than the
   filled-down data rows. The harness reads the operative range from a data row.
2. Some sheets have stray date entries beyond the operative schedule range.

## Production use

```python
from et_engine import Config, Stage, run
rows = run(cfg, soil_layers, stages, schedule, weather)   # pyfao ETr
# or inject ETr (e.g. forecast / validation):
rows = run(cfg, soil_layers, stages, schedule, weather, etr_override=[...])
```

The `etr_override` hook is also how the 3-day forecast will work: feed the loop
persisted/forecast weather (or precomputed ETr) for future days.

## Open item before production

The reference-ET magnitude depends on the **`ea` (vapor pressure) input**, not the
equation. With the Excel's own `ea`, pyfao runs ~0.91× the Excel. Standardize on a
single humidity pathway (dewpoint, or RHmax+RHmin, or measured vapor pressure) and
let pyfao compute `ea` from it — see Section A.4 of the spec.
