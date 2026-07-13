import { API_BASE, fetchState } from "@/lib/api";
import type { StateResponse } from "@/lib/types";
import { fmtDate } from "@/lib/format";

// Field-level flow meter (mirror backend/app/farm/schemas.py). ONE meter per
// field, measuring TOTAL water pumped across all zones. Optional + additive —
// the per-zone requirement windows never depend on it.

export type MeterUnit = "gallons" | "acre-inches" | "acre-feet" | "m3";

export interface MeterReading {
  date: string;
  meter_reading: number;
  unit: MeterUnit;
}

export interface MeterPoint {
  date: string;
  meter_reading: number;
  unit: string;
  increment_in: number;
  cumulative_pumped_in: number;
  cumulative_pumped_mm: number;
}

export interface MeterResponse {
  field_id: string;
  readings: MeterReading[];
  area_acres: number;
  area_basis: "field" | "manual";
  area_override: number | null;
  points: MeterPoint[];
  total_pumped_in: number;
  total_pumped_mm: number;
  note?: string | null;
}

export async function getMeter(fieldId: string): Promise<MeterResponse> {
  const res = await fetch(`${API_BASE}/api/fields/${fieldId}/meter`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function putMeter(
  fieldId: string,
  body: { readings: MeterReading[]; area_basis: "field" | "manual"; area_override: number | null }
): Promise<MeterResponse> {
  const res = await fetch(`${API_BASE}/api/fields/${fieldId}/meter`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Fetch every zone's engine run (its own sheet) so we can sum the field-level
// recommended total. Read-only — uses the existing /api/state, zone selection
// unchanged.
export async function fetchZoneStates(zoneIds: string[]): Promise<StateResponse[]> {
  const out = await Promise.all(
    zoneIds.map((zid) => fetchState(false, undefined, zid).catch(() => null))
  );
  return out.filter((s): s is StateResponse => s != null);
}

export const MM_PER_IN = 25.4;

export const METER_UNITS: { value: MeterUnit; label: string }[] = [
  { value: "gallons", label: "gallons" },
  { value: "acre-inches", label: "acre-inches" },
  { value: "acre-feet", label: "acre-feet" },
  { value: "m3", label: "m³" },
];

// One zone's cumulative recommended irrigation (Σ model-gated applied, Irrig+Fert)
// at each of its own series dates.
function zoneCumulative(state: StateResponse): { date: string; cum: number }[] {
  let c = 0;
  return state.series.map((p) => {
    if (p.applied > 0) c += p.applied;
    return { date: p.date, cum: c };
  });
}

export type Tracking = "on-track" | "above" | "below";

export interface OverlayRow {
  date: string;
  label: string;
  recommendedMm: number; // Σ zones, forward-filled to this date
  pumpedMm: number | null; // meter cumulative, null before the baseline reading
}

export interface Overlay {
  rows: OverlayRow[];
  recommendedTotalMm: number; // as of the latest reading date (fair, same-date compare)
  pumpedTotalMm: number;
  latestReadingDate: string | null;
  // Two DISTINCT reads:
  tracking: Tracking | null;    // (1) tracking vs plan: above / on-track / below the recommended total
  efficiencyPct: number | null; // (2) system efficiency (loss metric): ONLY when pumped >= recommended,
                                //     so it is ≤100 by construction; null in deficit (see `deficit`).
  deficit: boolean;             // pumped < recommended — behind plan; efficiency does not apply
}

/**
 * Field-level overlay: cumulative total pumped (meter) vs cumulative total
 * recommended (sum of all zones) on one shared date axis. The recommended curve
 * is a step that increments on each zone's trigger date; the pumped curve steps
 * on each meter reading. Efficiency compares the two AS OF the latest reading
 * date so it's a fair same-date total-vs-total check.
 */
export function buildOverlay(states: StateResponse[], meterPoints: MeterPoint[]): Overlay {
  const perZone = states.map(zoneCumulative);
  const meter = [...meterPoints].sort((a, b) => a.date.localeCompare(b.date));

  const allDates = Array.from(
    new Set([...perZone.flatMap((z) => z.map((p) => p.date)), ...meter.map((p) => p.date)])
  ).sort();

  const zi = perZone.map(() => 0);
  const zLast = perZone.map(() => 0);
  let mi = 0;
  let mLast: number | null = null;

  const rows: OverlayRow[] = allDates.map((d) => {
    let rec = 0;
    perZone.forEach((z, k) => {
      while (zi[k] < z.length && z[zi[k]].date <= d) {
        zLast[k] = z[zi[k]].cum;
        zi[k]++;
      }
      rec += zLast[k];
    });
    while (mi < meter.length && meter[mi].date <= d) {
      mLast = meter[mi].cumulative_pumped_mm;
      mi++;
    }
    return { date: d, label: fmtDate(d), recommendedMm: rec, pumpedMm: mLast };
  });

  const latestReadingDate = meter.length ? meter[meter.length - 1].date : null;
  const pumpedTotalMm = meter.length ? meter[meter.length - 1].cumulative_pumped_mm : 0;
  // recommended as of the latest reading date (forward-filled), else full-season total
  const recRow =
    latestReadingDate != null
      ? [...rows].reverse().find((r) => r.date <= latestReadingDate) ?? rows[rows.length - 1]
      : rows[rows.length - 1];
  const recommendedTotalMm = recRow ? recRow.recommendedMm : 0;

  let efficiencyPct: number | null = null;
  let tracking: Tracking | null = null;
  let deficit = false;
  if (pumpedTotalMm > 0 && recommendedTotalMm > 0) {
    const ratio = pumpedTotalMm / recommendedTotalMm;
    tracking = ratio > 1.1 ? "above" : ratio < 0.9 ? "below" : "on-track";
    // System efficiency is a LOSS metric — it only reads meaningfully once at
    // least the recommended amount was pumped; then recommended/pumped ≤ 1 and
    // the gap below 100% = losses/excess. When pumped < recommended it's a
    // DEFICIT (behind plan), not "efficiency" — leave it null and flag deficit.
    if (pumpedTotalMm >= recommendedTotalMm) {
      efficiencyPct = (recommendedTotalMm / pumpedTotalMm) * 100; // ≤ 100 by construction
    } else {
      deficit = true;
    }
  }

  return { rows, recommendedTotalMm, pumpedTotalMm, latestReadingDate, efficiencyPct, tracking, deficit };
}

export const TRACK_COLOR: Record<Tracking, string> = {
  "on-track": "var(--brand)",
  above: "var(--status-now)",
  below: "var(--status-soon)",
};
export const TRACK_LABEL: Record<Tracking, string> = {
  "on-track": "tracking the plan",
  above: "above the plan (over-applied)",
  below: "below the plan (under-applied)",
};
