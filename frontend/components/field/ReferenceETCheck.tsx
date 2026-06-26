"use client";

import { useMemo } from "react";
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Gauge, CheckCircle2, TriangleAlert, CloudOff } from "lucide-react";
import type { ETResponse } from "@/lib/field/types";
import CollapsibleCard from "./CollapsibleCard";
import { Skeleton } from "@/components/ui/skeleton";

type EtrDaily = { date: string; etr: number | null };
type Range = { start: string; end: string } | undefined;

export default function ReferenceETCheck({
  etrDaily,
  range,
  et,
  etLoading,
}: {
  etrDaily: EtrDaily[];
  range: Range;
  et: ETResponse | null;
  etLoading: boolean;
}) {
  const { data, pct, hasGrid, note, coverage } = useMemo(() => {
    if (range === undefined) return { data: [] as any[], pct: null as number | null, hasGrid: false, note: null as string | null, coverage: "ok" };
    const inRange = (d: string) => d >= range.start && d <= range.end;
    const station = new Map<string, number>();
    for (const p of etrDaily) if (p.etr != null && inRange(p.date)) station.set(p.date, p.etr);
    const grid = new Map<string, number>();
    for (const p of et?.etr_gridmet ?? []) if (inRange(p.date)) grid.set(p.date, p.mm);

    const dates = [...new Set([...station.keys(), ...grid.keys()])].sort();
    const data = dates.map((d) => ({
      t: new Date(d).getTime(), date: d,
      station: station.get(d) ?? null,
      gridmet: grid.get(d) ?? null,
    }));
    // within-% from the overlap (sum where both exist)
    let ss = 0, gs = 0;
    for (const d of dates) {
      if (station.has(d) && grid.has(d)) { ss += station.get(d)!; gs += grid.get(d)!; }
    }
    const pct = gs > 0 ? ((ss - gs) / gs) * 100 : null;
    return { data, pct, hasGrid: grid.size > 0, note: et?.note ?? null, coverage: et?.coverage ?? "ok" };
  }, [etrDaily, et, range]);

  return (
    <CollapsibleCard
      title="Reference-ET cross-check"
      subtitle="Station ETr (engine) vs gridMET ETr (OpenET) · mm/day"
      icon={Gauge}
    >
      {range === undefined || (etLoading && !et) ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-hairline bg-soil-soft/20 py-8 text-center text-sm text-muted">
          <CloudOff className="h-6 w-6" />
          No station ETr in this range.
        </div>
      ) : (
        <>
          <Summary coverage={coverage} hasGrid={hasGrid} pct={pct} note={note} />
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={data} margin={{ top: 8, right: 14, bottom: 4, left: 4 }}>
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]}
                tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                tick={{ fontSize: 10, fill: "#6B7069", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={{ stroke: "#E7E5DF" }} />
              <YAxis width={34} tick={{ fontSize: 10, fill: "#6B7069", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} />
              <Tooltip content={<RefTip />} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: "var(--font-mono)" }} iconType="plainline" />
              <Line name="Station ETr" type="monotone" dataKey="station" stroke="var(--brand)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              <Line name="gridMET ETr" type="monotone" dataKey="gridmet" stroke="var(--water)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </>
      )}
    </CollapsibleCard>
  );
}

function Summary({ coverage, hasGrid, pct, note }: any) {
  if (coverage === "out_of_area") {
    return <Banner icon={CloudOff} tone="muted" text="gridMET reference ET unavailable — field is outside OpenET coverage." />;
  }
  if (!hasGrid || pct == null) {
    const clean = note && /OPENET_API_KEY/i.test(note)
      ? "Add an OpenET API key to cross-check against gridMET."
      : "gridMET reference ET isn’t available for this range yet — showing station ETr only.";
    return <Banner icon={CloudOff} tone="muted" text={clean} title={note || undefined} />;
  }
  const p = Math.round(pct);
  if (Math.abs(pct) <= 10) {
    return <Banner icon={CheckCircle2} tone="hold" text={`Station ETr within ${Math.abs(p)}% of gridMET — station feed looks sound.`} />;
  }
  const dir = pct > 0 ? "high" : "low";
  return <Banner icon={TriangleAlert} tone="soon" text={`Station ETr running ${Math.abs(p)}% ${dir} vs gridMET — worth checking the feed.`} />;
}

function Banner({ icon: Icon, tone, text, title }: { icon: any; tone: "soon" | "hold" | "muted"; text: string; title?: string }) {
  const cls =
    tone === "soon" ? "border-status-soon/30 bg-status-soon/[0.08] text-status-soon"
    : tone === "hold" ? "border-status-hold/25 bg-status-hold/[0.07] text-status-hold"
    : "border-hairline bg-soil-soft/30 text-muted";
  return (
    <div title={title} className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${cls}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function RefTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-lg border border-hairline bg-card px-3 py-2 font-mono text-xs shadow-hero">
      <div className="mb-1 font-semibold text-ink">{row?.date}</div>
      <Row k="station ETr" v={row?.station != null ? `${row.station.toFixed(2)} mm` : "—"} />
      <Row k="gridMET ETr" v={row?.gridmet != null ? `${row.gridmet.toFixed(2)} mm` : "—"} />
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-muted">{k}</span>
      <span className="font-medium text-ink">{v}</span>
    </div>
  );
}
