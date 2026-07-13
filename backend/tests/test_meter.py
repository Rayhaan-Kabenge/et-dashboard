"""Field-level flow-meter → pumped-depth conversion (no network, no engine)."""
from __future__ import annotations

import pytest

from app.farm import meter
from app.farm.schemas import Field, FieldMeter, MeterReading, Zone


def _field(area_acres=None) -> Field:
    return Field(id="field-x", name="Colby", area_acres=area_acres,
                 zones=[Zone(id="z1", name="Corn", crop="corn", sheet_id="S")])


def test_baseline_reading_is_a_zero_point():
    m = FieldMeter(area_basis="manual", area_override=100.0,
                   readings=[MeterReading(date="2026-06-01", meter_reading=5_000_000, unit="gallons")])
    r = meter.compute(_field(), m)
    assert len(r.points) == 1
    assert r.points[0].cumulative_pumped_in == 0.0
    assert r.total_pumped_in == 0.0


def test_gallons_conversion_27154_basis():
    # 130-ac field; pump 27,154 gal/ac * 130 ac = 3,530,020 gal over baseline -> exactly 1 inch.
    field = _field()
    m = FieldMeter(area_basis="manual", area_override=130.0, readings=[
        MeterReading(date="2026-06-01", meter_reading=0, unit="gallons"),
        MeterReading(date="2026-06-15", meter_reading=meter.GAL_PER_ACRE_INCH * 130.0, unit="gallons"),
    ])
    r = meter.compute(field, m)
    assert r.points[-1].cumulative_pumped_in == pytest.approx(1.0, abs=1e-6)
    assert r.total_pumped_mm == pytest.approx(25.4, abs=1e-3)
    assert r.area_basis == "manual" and r.area_acres == 130.0


def test_all_units_agree():
    field = _field()
    def depth(unit, base, top):
        m = FieldMeter(area_basis="manual", area_override=10.0, readings=[
            MeterReading(date="2026-06-01", meter_reading=base, unit=unit),
            MeterReading(date="2026-06-10", meter_reading=top, unit=unit),
        ])
        return meter.compute(field, m).total_pumped_in
    assert depth("acre-inches", 0, 10) == pytest.approx(1.0, abs=1e-4)          # 10 ac-in / 10 ac
    assert depth("gallons", 0, 10 * meter.GAL_PER_ACRE_INCH) == pytest.approx(1.0, abs=1e-4)
    assert depth("acre-feet", 0, 10 / 12.0) == pytest.approx(1.0, abs=1e-4)
    assert depth("m3", 0, 10 * meter.GAL_PER_ACRE_INCH / meter.GAL_PER_M3) == pytest.approx(1.0, abs=1e-4)


def test_area_basis_field_uses_field_acreage():
    field = _field(area_acres=50.0)
    m = FieldMeter(area_basis="field", readings=[
        MeterReading(date="2026-06-01", meter_reading=0, unit="gallons"),
        MeterReading(date="2026-06-15", meter_reading=meter.GAL_PER_ACRE_INCH * 50.0, unit="gallons"),
    ])
    r = meter.compute(field, m)
    assert r.area_basis == "field" and r.area_acres == 50.0
    assert r.points[-1].cumulative_pumped_in == pytest.approx(1.0, abs=1e-6)


def test_no_field_area_and_no_override_notes_gracefully():
    field = _field(area_acres=None)  # Colby-style: no field acreage yet
    m = FieldMeter(area_basis="field", readings=[
        MeterReading(date="2026-06-01", meter_reading=0, unit="gallons"),
        MeterReading(date="2026-06-15", meter_reading=1_000_000, unit="gallons"),
    ])
    r = meter.compute(field, m)
    assert r.area_acres == 0.0
    assert r.total_pumped_in == 0.0        # can't convert without an area
    assert r.note and "area" in r.note.lower()


def test_readings_accumulate_sorted_and_monotonic():
    field = _field()
    step = meter.GAL_PER_ACRE_INCH * 100.0  # 1 inch per step on 100 ac
    m = FieldMeter(area_basis="manual", area_override=100.0, readings=[
        MeterReading(date="2026-07-01", meter_reading=2 * step, unit="gallons"),   # out of order
        MeterReading(date="2026-06-01", meter_reading=0, unit="gallons"),
        MeterReading(date="2026-06-15", meter_reading=step, unit="gallons"),
    ])
    r = meter.compute(field, m)
    assert [p.date for p in r.points] == ["2026-06-01", "2026-06-15", "2026-07-01"]
    assert [round(p.cumulative_pumped_in, 3) for p in r.points] == [0.0, 1.0, 2.0]

    m2 = FieldMeter(area_basis="manual", area_override=100.0, readings=[
        MeterReading(date="2026-06-01", meter_reading=step, unit="gallons"),
        MeterReading(date="2026-06-15", meter_reading=0, unit="gallons"),  # rollover/typo
    ])
    r2 = meter.compute(field, m2)
    assert r2.points[-1].increment_in == 0.0   # clamped, never negative
