"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceDot, ResponsiveContainer,
} from "recharts";
import { Gauge, Plus, Trash2, MapPin, AlertTriangle, Check, Info } from "lucide-react";
import type { StateResponse } from "@/lib/types";
import { useActiveZone } from "@/lib/zones";
import { useUnits, toDisplay } from "@/lib/units";
import {
  getMeter, putMeter, fetchZoneStates, buildOverlay, METER_UNITS,
  TRACK_COLOR, TRACK_LABEL, type MeterResponse, type MeterUnit, type Overlay,
} from "@/lib/meter";
import { Button } from "@/components/ui/button";
import CardChevron from "@/components/CardChevron";

const AXIS = { fontSize: 11, fill: "#6B7069", fontFamily: "var(--font-mono)" };
const today = () => new Date().toISOString().slice(0, 10);

interface Row {
  date: string;
  reading: string; // string so the input can be typed/cleared freely
  unit: MeterUnit;
}

/**
 * Field-level pumping-meter overlay (all zones). Compares cumulative TOTAL pumped
 * (one field meter) against cumulative TOTAL recommended (sum of every zone's own
 * recommendation). Optional + additive: with no readings the per-zone windows and
 * everything else render normally. Never touches the engine or zone selection.
 */
export default function MeterOverlay() {
  const { field, zones } = useActiveZone();
  const { unit } = useUnits();
  const [open, setOpen] = useState(true);
  const [meter, setMeter] = useState<MeterResponse | null>(null);
  const [states, setStates] = useState<StateResponse[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [areaBasis, setAreaBasis] = useState<"field" | "manual">("field");
  const [areaOverride, setAreaOverride] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldId = field?.id;
  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  useEffect(() => {
    if (!fieldId || zoneIds.length === 0) return;
    let alive = true;
    setLoading(true);
    Promise.all([getMeter(fieldId), fetchZoneStates(zoneIds)])
      .then(([m, s]) => {
        if (!alive) return;
        setMeter(m);
        setStates(s);
        setRows(m.readings.map((r) => ({ date: r.date, reading: String(r.meter_reading), unit: r.unit })));
        setAreaBasis(m.area_basis);
        setAreaOverride(m.area_override != null ? String(m.area_override) : "");
      })
      .catch((e) => alive && setError(e?.message ?? "Failed to load meter"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [fieldId, zoneIds]);

  const overlay: Overlay | null = useMemo(
    () => (meter ? buildOverlay(states, meter.points) : null),
    [states, meter]
  );

  const setRow = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const addRow = () =>
    setRows((rs) => {
      setDirty(true);
      return [...rs, { date: today(), reading: "", unit: (rs[rs.length - 1]?.unit ?? "gallons") as MeterUnit }];
    });
  const removeRow = (i: number) => {
    setRows((rs) => rs.filter((_, j) => j !== i));
    setDirty(true);
  };

  const save = useCallback(async () => {
    if (!fieldId) return;
    setSaving(true);
    setError(null);
    try {
      const readings = rows
        .filter((r) => r.date && r.reading.trim() !== "" && Number.isFinite(Number(r.reading)))
        .map((r) => ({ date: r.date, meter_reading: Number(r.reading), unit: r.unit }));
      const override = areaOverride.trim() !== "" && Number(areaOverride) > 0 ? Number(areaOverride) : null;
      const m = await putMeter(fieldId, { readings, area_basis: areaBasis, area_override: override });
      setMeter(m);
      setRows(m.readings.map((r) => ({ date: r.date, reading: String(r.meter_reading), unit: r.unit })));
      setDirty(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save meter");
    } finally {
      setSaving(false);
    }
  }, [fieldId, rows, areaBasis, areaOverride]);

  const fmt = (mm: number | null | undefined) => {
    const v = toDisplay(mm ?? 0, unit);
    return v == null ? "—" : `${v.toFixed(unit === "in" ? 2 : 1)} ${unit}`;
  };
  const hasReadings = (meter?.points.length ?? 0) > 0;

  return (
    <div className="card p-6">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <CardChevron open={open} onClick={() => setOpen((o) => !o)} label="pumping meter" />
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <Gauge className="h-4 w-4 text-water" /> Field pumping vs recommended
              <span className="rounded-full bg-water/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-water">
                field · all zones
              </span>
            </h3>
            <p className="text-sm text-ink/50">
              One field meter (whole field) vs the summed per-zone recommendation — a field-level “tracking the plan?” check.
              <span className="text-ink/40"> Independent of the zone you drill into above.</span>
            </p>
          </div>
        </div>
      </div>

      {open && (
        <div className="mt-4">
          {loading ? (
            <div className="h-40 w-full animate-pulse rounded-md bg-ink/[0.05]" />
          ) : !field ? (
            <Empty>No active field.</Empty>
          ) : (
            <>
              {hasReadings ? (
                <div className="space-y-5">
                  {overlay && <EfficiencyStrip overlay={overlay} fmt={fmt} />}
                  {overlay && <OverlayChart overlay={overlay} unit={unit} points={meter!.points} />}
                </div>
              ) : (
                <Empty>
                  No meter readings yet. Add the season-baseline reading, then later readings — the field’s
                  cumulative pumped total will overlay the recommended total below. The per-zone windows work without it.
                </Empty>
              )}

              <MeterForm
                rows={rows}
                meter={meter}
                fieldArea={field.area_acres ?? null}
                areaBasis={areaBasis}
                areaOverride={areaOverride}
                setRow={setRow}
                addRow={addRow}
                removeRow={removeRow}
                setAreaBasis={(b) => {
                  setAreaBasis(b);
                  setDirty(true);
                }}
                setAreaOverride={(v) => {
                  setAreaOverride(v);
                  setDirty(true);
                }}
                save={save}
                saving={saving}
                dirty={dirty}
                fmt={fmt}
              />

              {meter?.note && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-status-soon/30 bg-status-soon/[0.08] px-3 py-2 text-xs text-status-soon">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {meter.note}
                </div>
              )}
              {error && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-status-now/30 bg-status-now/[0.08] px-3 py-2 text-xs text-status-now">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Two DISTINCT reads: (1) tracking vs plan (above/on/below the recommended total)
// and (2) system efficiency (the loss gap) — the latter only when pumped ≥
// recommended; a deficit is shown as a deficit, never as ">100% efficiency".
function EfficiencyStrip({ overlay, fmt }: { overlay: Overlay; fmt: (mm: number) => string }) {
  const { pumpedTotalMm, recommendedTotalMm, tracking, efficiencyPct, deficit } = overlay;
  const eff = efficiencyPct;
  const lossGap = eff != null ? 100 - eff : null;
  const pctOfPlan =
    recommendedTotalMm > 0 && pumpedTotalMm > 0
      ? Math.round((pumpedTotalMm / recommendedTotalMm) * 100)
      : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Total pumped (meter)" value={fmt(pumpedTotalMm)} />
      <Stat label="Total recommended (all zones)" value={fmt(recommendedTotalMm)} />

      {/* Read 1 — tracking vs the plan */}
      <div className="rounded-lg border border-hairline bg-soil-soft/20 px-3 py-2">
        <div className="stat-label">Tracking vs plan</div>
        {tracking ? (
          <div className="mt-0.5 font-mono text-sm font-semibold" style={{ color: TRACK_COLOR[tracking] }}>
            {TRACK_LABEL[tracking]}
          </div>
        ) : (
          <div className="mt-0.5 font-mono text-sm text-muted">no recommendation yet</div>
        )}
        <div className="font-mono text-[11px] text-muted">
          {pctOfPlan != null ? `pumped ${pctOfPlan}% of the recommended total` : "—"}
        </div>
      </div>

      {/* Read 2 — system efficiency (loss gap), only when pumped ≥ recommended */}
      <div className="rounded-lg border border-hairline bg-water/[0.05] px-3 py-2">
        <div className="stat-label flex items-center gap-1.5">
          <Info className="h-3 w-3 text-water" /> System efficiency
        </div>
        {eff != null ? (
          <>
            <div className="mt-0.5 font-mono text-lg font-semibold text-ink">{eff.toFixed(0)}%</div>
            <div className="font-mono text-[11px] leading-snug text-muted">
              loss gap {lossGap!.toFixed(0)}% — pumped water not matched to the plan
            </div>
          </>
        ) : deficit ? (
          <>
            <div className="mt-0.5 font-mono text-sm font-semibold" style={{ color: TRACK_COLOR.below }}>
              deficit — behind plan
            </div>
            <div className="font-mono text-[11px] leading-snug text-muted">
              efficiency applies once pumped ≥ recommended
            </div>
          </>
        ) : (
          <>
            <div className="mt-0.5 font-mono text-lg font-semibold text-ink/40">—</div>
            <div className="font-mono text-[11px] leading-snug text-muted">
              {pumpedTotalMm > 0 ? "no recommendation yet to compare" : "add a reading beyond the baseline"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-soil-soft/20 px-3 py-2">
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}

function OverlayChart({
  overlay,
  unit,
  points,
}: {
  overlay: Overlay;
  unit: "mm" | "in";
  points: MeterResponse["points"];
}) {
  const data = overlay.rows.map((r) => ({
    label: r.label,
    date: r.date,
    recommended: toDisplay(r.recommendedMm, unit),
    pumped: r.pumpedMm != null ? toDisplay(r.pumpedMm, unit) : null,
  }));
  const readingLabels = new Set(points.map((p) => p.date));
  const dotColor = overlay.tracking ? TRACK_COLOR[overlay.tracking] : "var(--ink)";

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 12, right: 14, bottom: 4, left: 2 }}>
          <XAxis dataKey="label" tick={AXIS} interval={Math.max(0, Math.floor(data.length / 8))}
            tickLine={false} axisLine={{ stroke: "#E7E5DF" }} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} domain={[0, "auto"]}
            label={{ value: `cumulative depth · ${unit}`, angle: -90, position: "insideLeft",
              style: { fontSize: 11, fill: "#6B7069", fontFamily: "var(--font-mono)" } }} />
          <Tooltip content={<ChartTip unit={unit} />} cursor={{ stroke: "#E7E5DF" }} />
          {/* summed per-zone recommended total (the plan) */}
          <Line type="stepAfter" dataKey="recommended" name="Recommended (all zones)"
            stroke="var(--soil)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          {/* field meter — cumulative total pumped */}
          <Line type="stepAfter" dataKey="pumped" name="Pumped (meter)"
            stroke={dotColor} strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls={false} />
          {data
            .filter((d) => d.pumped != null && readingLabels.has(d.date))
            .map((d) => (
              <ReferenceDot key={d.date} x={d.label} y={d.pumped as number} r={3.5}
                fill={dotColor} stroke="white" strokeWidth={1.3} ifOverflow="extendDomain" />
            ))}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center gap-4 font-mono text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2" style={{ borderColor: "var(--soil)" }} /> recommended (all zones)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2" style={{ borderColor: dotColor }} /> pumped (meter)</span>
      </div>
    </div>
  );
}

function ChartTip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const f = (v: number | null) => (v == null ? "—" : `${v.toFixed(unit === "in" ? 2 : 1)} ${unit}`);
  return (
    <div className="rounded-lg border border-hairline bg-card px-3 py-2 font-mono text-xs shadow-hero">
      <div className="mb-1 font-semibold text-ink">{label}</div>
      <Trow k="recommended" v={f(row?.recommended)} />
      <Trow k="pumped" v={f(row?.pumped)} />
    </div>
  );
}
function Trow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-6 tabular-nums">
      <span className="text-muted">{k}</span>
      <span className="font-medium text-ink">{v}</span>
    </div>
  );
}

function MeterForm({
  rows, meter, fieldArea, areaBasis, areaOverride,
  setRow, addRow, removeRow, setAreaBasis, setAreaOverride, save, saving, dirty, fmt,
}: {
  rows: Row[];
  meter: MeterResponse | null;
  fieldArea: number | null;
  areaBasis: "field" | "manual";
  areaOverride: string;
  setRow: (i: number, patch: Partial<Row>) => void;
  addRow: () => void;
  removeRow: (i: number) => void;
  setAreaBasis: (b: "field" | "manual") => void;
  setAreaOverride: (v: string) => void;
  save: () => void;
  saving: boolean;
  dirty: boolean;
  fmt: (mm: number) => string;
}) {
  return (
    <div className="mt-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left font-mono text-xs text-muted">
              <th className="py-1.5 pr-3 font-normal">date</th>
              <th className="py-1.5 pr-3 font-normal">meter reading</th>
              <th className="py-1.5 pr-3 font-normal">unit</th>
              <th className="py-1.5 pr-3 font-normal text-right">pumped to date</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-sm text-ink/40">
                  Add the season-baseline reading first — it’s the zero point.
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const pt = meter?.points.find((p) => p.date === r.date);
              return (
                <tr key={i} className="border-b border-hairline/60">
                  <td className="py-1.5 pr-3">
                    <input type="date" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })}
                      className="w-[9.5rem] rounded-md border border-hairline bg-card px-2 py-1 font-mono text-xs text-ink focus:border-brand/50 focus:outline-none" />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input type="number" inputMode="decimal" value={r.reading}
                      placeholder={i === 0 ? "baseline" : "reading"}
                      onChange={(e) => setRow(i, { reading: e.target.value })}
                      className="w-36 rounded-md border border-hairline bg-card px-2 py-1 text-right font-mono text-xs text-ink focus:border-brand/50 focus:outline-none" />
                  </td>
                  <td className="py-1.5 pr-3">
                    <select value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value as MeterUnit })}
                      className="rounded-md border border-hairline bg-card px-2 py-1 font-mono text-xs text-ink focus:border-brand/50 focus:outline-none">
                      {METER_UNITS.map((u) => (
                        <option key={u.value} value={u.value}>{u.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-ink/70">
                    {i === 0 ? <span className="text-ink/35">baseline</span> : pt ? fmt(pt.cumulative_pumped_mm) : "—"}
                  </td>
                  <td className="py-1.5 text-right">
                    <button type="button" onClick={() => removeRow(i)} aria-label="Remove reading"
                      className="rounded-md p-1 text-muted transition-colors hover:bg-status-now/10 hover:text-status-now">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" /> Add reading
        </Button>
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : dirty ? "Save" : (<><Check className="h-3.5 w-3.5" /> Saved</>)}
        </Button>

        {/* field area used for the volume→depth conversion */}
        <div className="ml-auto flex items-center gap-2 font-mono text-xs text-muted">
          <MapPin className="h-3.5 w-3.5" />
          <span>
            area <span className="text-ink/70">{meter ? meter.area_acres.toFixed(2) : "—"} ac</span>{" "}
            <span className="text-ink/40">({meter?.area_basis ?? areaBasis})</span>
          </span>
          <select value={areaBasis} onChange={(e) => setAreaBasis(e.target.value as "field" | "manual")}
            className="rounded-md border border-hairline bg-card px-2 py-1 text-ink focus:border-brand/50 focus:outline-none">
            <option value="field">field acreage{fieldArea ? ` (${fieldArea.toFixed(2)})` : " (unset)"}</option>
            <option value="manual">manual</option>
          </select>
          {areaBasis === "manual" && (
            <input type="number" inputMode="decimal" value={areaOverride} placeholder="acres"
              onChange={(e) => setAreaOverride(e.target.value)}
              className="w-24 rounded-md border border-hairline bg-card px-2 py-1 text-right text-ink focus:border-brand/50 focus:outline-none" />
          )}
        </div>
      </div>

      <p className="mt-3 font-mono text-[11px] leading-relaxed text-ink/45">
        basis 27,154 gal = 1 acre-inch. System efficiency = recommended ÷ pumped, shown only once pumped ≥ recommended
        (the gap = losses/excess); under-applying is a deficit, not efficiency. It mixes system losses
        (leaks/drift/evaporation) with deviation from the plan, so it’s cleanest when applications followed the recommendation.
      </p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-hairline bg-soil-soft/25 px-4 py-4 text-sm text-ink/60">
      <Gauge className="h-4 w-4 shrink-0 text-soil/70" /> {children}
    </div>
  );
}
