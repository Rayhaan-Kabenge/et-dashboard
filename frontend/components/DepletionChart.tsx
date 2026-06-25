"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
} from "recharts";
import type { StateResponse } from "@/lib/types";
import { useUnits, toDisplay, fmtDepth } from "@/lib/units";
import { fmtDate } from "@/lib/format";

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
      // bridge the forecast line back to the last actual point so it connects
      depForecast: isF || i === lastActualIdx ? dep : null,
      ad: toDisplay(p.ad, unit),
      applied: p.applied,
      precip: toDisplay(p.precip, unit),
      isForecast: isF,
    };
  });

  const firstForecast = series.find((p) => p.is_forecast)?.date;
  const lastDate = series[series.length - 1]?.date;
  const projected = state.decision?.projected_trigger_date ?? null;
  const events = series
    .filter((p) => p.applied > 0)
    .map((p) => ({ date: p.date, y: toDisplay(p.depletion, unit), type: state.schedule.find((s) => s.date === p.date)?.type ?? "Irrig" }));

  if (!mounted) return <div className="h-[340px] w-full animate-pulse rounded-xl bg-black/5" />;

  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
        <defs>
          <linearGradient id="depFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3f8a45" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#3f8a45" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1b242010" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#1b242080" }}
          interval={Math.max(0, Math.floor(data.length / 9))}
          tickLine={false}
          axisLine={{ stroke: "#1b242018" }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#1b242080" }}
          tickLine={false}
          axisLine={false}
          width={44}
          label={{ value: `depth (${unit})`, angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#1b242066" } }}
        />
        <Tooltip content={<ChartTip unit={unit} />} />

        {/* forecast window shading */}
        {firstForecast && lastDate && (
          <ReferenceArea
            x1={fmtDate(firstForecast)}
            x2={fmtDate(lastDate)}
            fill="#3f8fc0"
            fillOpacity={0.06}
            ifOverflow="extendDomain"
          />
        )}

        {/* AD threshold (steps per stage) */}
        <Line type="stepAfter" dataKey="ad" name="AD" stroke="#cf8a1c" strokeWidth={1.6} strokeDasharray="5 4" dot={false} connectNulls />

        {/* actual depletion */}
        <Area type="monotone" dataKey="depActual" name="Depletion" stroke="#2f6b36" strokeWidth={2.4} fill="url(#depFill)" dot={false} connectNulls={false} />

        {/* forecast depletion */}
        <Line type="monotone" dataKey="depForecast" name="Depletion (forecast)" stroke="#3f8fc0" strokeWidth={2.2} strokeDasharray="4 4" dot={false} connectNulls />

        {/* projected trigger crossing */}
        {projected && (
          <ReferenceLine
            x={fmtDate(projected)}
            stroke="#bf4a2c"
            strokeWidth={1.4}
            strokeDasharray="3 3"
            label={{ value: "trigger", position: "top", fontSize: 10, fill: "#bf4a2c" }}
          />
        )}

        {/* irrigation / fert events */}
        {events.map((e) => (
          <ReferenceDot
            key={e.date}
            x={fmtDate(e.date)}
            y={e.y ?? 0}
            r={5}
            fill={e.type === "Fert" ? "#5aa9d6" : "#2f6b36"}
            stroke="#fff"
            strokeWidth={1.5}
            ifOverflow="extendDomain"
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ChartTip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const dep = row?.depActual ?? row?.depForecast;
  return (
    <div className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs shadow-card">
      <div className="mb-1 font-semibold text-ink">
        {label} {row?.isForecast && <span className="text-sky-500">· forecast</span>}
      </div>
      <Row k="Depletion" v={dep != null ? `${dep.toFixed(unit === "in" ? 2 : 1)} ${unit}` : "—"} />
      <Row k="AD" v={row?.ad != null ? `${row.ad.toFixed(unit === "in" ? 2 : 1)} ${unit}` : "—"} />
      {row?.precip ? <Row k="Precip" v={`${row.precip.toFixed(unit === "in" ? 2 : 1)} ${unit}`} /> : null}
      {row?.applied ? <Row k="Applied" v={`${toDisplayLocal(row.applied, unit)} ${unit}`} /> : null}
    </div>
  );
}

function toDisplayLocal(mm: number, unit: string) {
  return unit === "in" ? (mm / 25.4).toFixed(2) : mm.toFixed(1);
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-6 tabular-nums">
      <span className="text-ink/50">{k}</span>
      <span className="font-medium text-ink">{v}</span>
    </div>
  );
}
