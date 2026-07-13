"""Field flow-meter log → cumulative pumped depth (inches / mm).

A field has ONE odometer-style meter measuring TOTAL water pumped across all its
zones. Each reading minus the previous = the volume pumped in that interval;
converted to acre-inches and divided by the FIELD area gives the incremental
pumped depth, which we accumulate. The first reading is the season baseline
(increment 0). A meter only counts up, so a lower reading than the previous
(rollover / entry slip) contributes zero, never negative.

Conversion basis (US customary), cribbed from the pumping-overlay reference:
    27,154 gallons = 1 acre-inch      1 acre-foot = 12 acre-inches
    1 m³ = 264.172 US gallons

This is a field-level, read-only assembly. It never touches the ET engine, the
per-zone requirement windows, or zone selection.
"""
from __future__ import annotations

from .schemas import Field, FieldMeter, MeterPoint, MeterResponse

GAL_PER_ACRE_INCH = 27154.0
GAL_PER_M3 = 264.1720524
ACRE_INCH_PER_ACRE_FOOT = 12.0
MM_PER_IN = 25.4


def _to_acre_inches(value: float, unit: str) -> float:
    """Absolute meter reading → acre-inches of pumped volume. Linear, so
    differencing the converted absolutes equals converting the difference (also
    makes mixed units across readings safe)."""
    u = (unit or "").strip().lower()
    if u in ("gallon", "gallons", "gal"):
        return value / GAL_PER_ACRE_INCH
    if u in ("acre-inch", "acre-inches", "ac-in", "acre_inches", "acre-in"):
        return value
    if u in ("acre-foot", "acre-feet", "ac-ft", "acre_feet"):
        return value * ACRE_INCH_PER_ACRE_FOOT
    if u in ("m3", "m³", "cubic-meter", "cubic-meters", "cubic_meters"):
        return value * GAL_PER_M3 / GAL_PER_ACRE_INCH
    raise ValueError(f"unknown meter unit: {unit!r}")


def _resolve_area(field: Field, meter: FieldMeter) -> tuple[float, str, str | None]:
    """Field area used for the depth conversion: the field's own acreage, or a
    positive manual override. Returns (acres, basis, note)."""
    override = meter.area_override
    field_area = float(field.area_acres) if field.area_acres else 0.0

    if meter.area_basis == "manual":
        if override and override > 0:
            return float(override), "manual", None
        if field_area > 0:  # manual requested but none given — fall back, flag it
            return field_area, "field", "Manual area not set; using the field acreage."
        return 0.0, "manual", "Set a manual field area (acres) to convert meter volume to depth."

    # basis == "field": prefer field acreage, else a manual override if present
    if field_area > 0:
        return field_area, "field", None
    if override and override > 0:
        return float(override), "manual", None
    return 0.0, "field", "Field has no area yet — set a manual field area (acres)."


def compute(field: Field, meter: FieldMeter) -> MeterResponse:
    """Cumulative pumped-depth series from the field meter log."""
    area, basis, note = _resolve_area(field, meter)
    readings = sorted(meter.readings, key=lambda r: r.date)

    points: list[MeterPoint] = []
    cum_in = 0.0
    prev_ai: float | None = None
    for r in readings:
        try:
            ai_total = _to_acre_inches(r.meter_reading, r.unit)
        except ValueError as exc:
            note = str(exc)
            ai_total = prev_ai if prev_ai is not None else 0.0
        if prev_ai is None:
            inc_in = 0.0                                   # season baseline: zero point
        else:
            inc_ai = max(0.0, ai_total - prev_ai)          # meter is monotonic (no negative pumping)
            inc_in = (inc_ai / area) if area > 0 else 0.0
        cum_in += inc_in
        points.append(MeterPoint(
            date=r.date, meter_reading=r.meter_reading, unit=r.unit,
            increment_in=round(inc_in, 4),
            cumulative_pumped_in=round(cum_in, 4),
            cumulative_pumped_mm=round(cum_in * MM_PER_IN, 3),
        ))
        prev_ai = ai_total

    return MeterResponse(
        field_id=field.id, readings=readings,
        area_acres=round(area, 4), area_basis=basis, area_override=meter.area_override,
        points=points,
        total_pumped_in=round(cum_in, 4), total_pumped_mm=round(cum_in * MM_PER_IN, 3),
        note=note,
    )
