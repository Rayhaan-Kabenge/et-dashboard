"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine, ReferenceDot, ResponsiveContainer,
} from "recharts";
import type { StateResponse } from "@/lib/types";
import { useUnits, toDisplay } from "@/lib/units";
import { fmtDate } from "@/lib/format";

const AXIS = { fontSize: 11, fill: "#6B7069", fontFamily: "var(--font-mono)" };

export default function DepletionChart({ state }: { state: StateResponse }) {
  const { unit } = useUnits();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const series = state.series;
  const lastActualIdx = series.reduce((acc, p, i) => (!p.is_forecast ? i : acc), 0);

  const data = series.map((p, i) => {
    const dep = toDisplay(p.depletion, unit);
    const isF = p.is_forecast;
    return {
      date: p.date,
      label: fmtDate(p.date),
      depActual: !isF ? dep : null,
      depForecast: isF || i === lastActualIdx ? dep : null, // bridge to last actual
      ad: toDisplay(p.ad, unit),
      precip: toDisplay(p.precip, unit),
      applied: p.applied,
      isForecast: isF,
    };
  });

  const firstForecast = series.find((p) => p.is_forecast)?.date;
  const lastDate = series[series.length - 1]?.date;
  const projected = state.decision?.projected_trigger_date ?? null;
  const events = series
    .filter((p) => p.applied > 0)
    .map((p) => ({
      date: p.date,
      y: toDisplay(p.depletion, unit),
      type: state.schedule.find((s) => s.date === p.date)?.type ?? "Irrig",
      amount: p.applied,
    }));

  if (!mounted) return <div className="h-[360px] w-full animate-pulse rounded-md bg-ink/[0.05]" />;

  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={data} margin={{ top: 14, right: 14, bottom: 4, left: 2 }}>
        <defs>
          <linearGradient id="depFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* forecast window shading (distinct from observed) */}
        {firstForecast && lastDate && (
          <ReferenceArea x1={fmtDate(firstForecast)} x2={fmtDate(lastDate)} fill="var(--water)" fillOpacity={0.05} ifOverflow="extendDomain" />
        )}

        <XAxis dataKey="label" tick={AXIS} interval={Math.max(0, Math.floor(data.length / 9))} tickLine={false} axisLine={{ stroke: "#E7E5DF" }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40}
          label={{ value: `depth (${unit})`, angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#6B7069", fontFamily: "var(--font-mono)" } }} />
        <Tooltip content={<ChartTip unit={unit} />} cursor={{ stroke: "#E7E5DF" }} />

        {/* AD threshold (steps per stage) */}
        <Line type="stepAfter" dataKey="ad" name="AD" stroke="var(--status-soon)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />

        {/* actual depletion (deficit) */}
        <Area type="monotone" dataKey="depActual" name="Depletion" stroke="var(--brand)" strokeWidth={2.4} fill="url(#depFill)" dot={false} connectNulls={false} />

        {/* forecast depletion */}
        <Line type="monotone" dataKey="depForecast" name="Forecast" stroke="var(--water)" strokeWidth={2.2} strokeDasharray="4 4" dot={false} connectNulls />

        {/* projected trigger crossing */}
        {projected && (
          <ReferenceLine x={fmtDate(projected)} stroke="var(--status-now)" strokeWidth={1.4} strokeDasharray="3 3"
            label={{ value: "trigger", position: "top", fontSize: 10, fill: "var(--status-now)", fontFamily: "var(--font-mono)" }} />
        )}

        {/* irrigation / fert events */}
        {events.map((e) => (
          <ReferenceDot key={e.date} x={fmtDate(e.date)} y={e.y ?? 0} r={4.5}
            fill={e.type === "Fert" ? "var(--soil)" : "var(--water)"} stroke="white" strokeWidth={1.5} ifOverflow="extendDomain"
            label={{ value: e.type === "Fert" ? "F" : "I", position: "top", fontSize: 9, fill: e.type === "Fert" ? "var(--soil-deep)" : "var(--water)", fontFamily: "var(--font-mono)" }} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ChartTip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const dep = row?.depActual ?? row?.depForecast;
  const fmt = (v: number) => v.toFixed(unit === "in" ? 2 : 1);
  return (
    <div className="rounded-lg border border-hairline bg-card px-3 py-2 font-mono text-xs shadow-hero">
      <div className="mb-1 font-semibold text-ink">
        {label} {row?.isForecast && <span className="text-water">· forecast</span>}
      </div>
      <Row k="depletion" v={dep != null ? `${fmt(dep)} ${unit}` : "—"} />
      <Row k="AD" v={row?.ad != null ? `${fmt(row.ad)} ${unit}` : "—"} />
      {row?.precip ? <Row k="precip" v={`${fmt(row.precip)} ${unit}`} /> : null}
      {row?.applied ? <Row k="applied" v={`${fmt(toDisplay(row.applied, unit) as number)} ${unit}`} /> : null}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-6 tabular-nums">
      <span className="text-muted">{k}</span>
      <span className="font-medium text-ink">{v}</span>
    </div>
  );
}
