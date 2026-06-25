"""Engine regression (acceptance criterion #1).

Reproduces `reference/validate_summary.py`: with the Excel's own ETr injected,
every Sections B-I column must match the historical workbook to <= 3e-3 (six of
seven years agree to floating-point round-off). If this breaks, the engine was
touched — revert.

Skips automatically when the workbook is absent (it is large and not committed);
CI provides reference/2017_2023_ETschudelr_Code.xlsm so the test runs there.
"""
import sys

import pytest

from conftest import REFERENCE_DIR, WORKBOOK

pytestmark = pytest.mark.skipif(
    not WORKBOOK.exists(),
    reason=f"reference workbook not found at {WORKBOOK} (provide it in CI to run regression)",
)

YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023]
THRESHOLD = 3e-3
NUMCOLS = ["gdd", "cumgdd", "ro", "fracint", "kcr", "etc", "dp", "depletion", "ad"]


def _na(v):
    return None if (v is None or (isinstance(v, str) and v.startswith("#"))) else v


def _validate_module():
    if str(REFERENCE_DIR) not in sys.path:
        sys.path.insert(0, str(REFERENCE_DIR))
    import validate  # reference/validate.py
    validate.XLSM = str(WORKBOOK)
    return validate


@pytest.mark.parametrize("year", YEARS)
def test_year_within_threshold(year):
    from et_engine import run

    validate = _validate_module()
    cfg, soil, stages, schedule, weather, gold = validate.load_year(year)
    out = run(cfg, soil, stages, schedule, weather,
              etr_override=[g["etr"] for g in gold])

    worst = 0.0
    na_cascade = 0
    for o, g in zip(out, gold):
        for c in NUMCOLS:
            a, b = o[c], _na(g[c])
            if a is None or b is None:
                if not (a is None and b is None):
                    na_cascade += 1
                continue
            worst = max(worst, abs(a - b))

    # discrete decisions must match exactly where both are defined
    should_mismatch = 0
    for o, g in zip(out, gold):
        gv = _na(g["should"])
        if gv is None or o["depletion"] is None:
            continue
        if bool(o["should_irrigate"]) != bool(gv):
            should_mismatch += 1
    applied_diff = max(abs((o["applied"] or 0) - (g["applied"] or 0))
                       for o, g in zip(out, gold))

    assert na_cascade == 0, f"{year}: NA cascade mismatch ({na_cascade})"
    assert worst <= THRESHOLD, f"{year}: worst|diff|={worst:.2e} > {THRESHOLD}"
    assert should_mismatch == 0, f"{year}: {should_mismatch} should-irrigate mismatches"
    assert applied_diff < 1e-9, f"{year}: applied|diff|={applied_diff:.2e}"
