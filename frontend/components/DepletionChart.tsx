"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceArea, ReferenceLine, ReferenceDot, ResponsiveContainer,
} from "recharts";
import type { StateResponse } from "@/lib/types";
import { useUnits, toDisplay } from "@/lib/units";
import { fmtDate } from "@/lib/format";

const AXIS = { fontSize: 11, fill: "#6B7069", fontFamily: "var(--font-mono)" };

// Fuel-gauge orientation (display transform ONLY — the engine's depletion math is
// untouched): we plot REMAINING available water before the trigger, (AD − depletion),
// so crop water use makes the line FALL, rain/irrigation makes it RISE, and the
// trigger is reached when the line descends to zero.
export default function DepletionChart({ state }: { state: StateResponse }) {
  const { unit } = useUnits();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const series = state.series;
  const lastActualIdx = series.reduce((acc, p, i) => (!p.is_forecast ? i : acc), 0);

  // remaining = AD − depletion (converted for display). Null when either side is
  // undefined (e.g. AD not defined for the stage) — the line simply gaps.
  const remainingOf = (p: (typeof series)[number]) =>
    p.ad != null && p.depletion != null ? toDisplay(p.ad - p.depletion, unit) : null;

  // Requirement window (guardrails, not a setpoint): the 100% line is the engine's
  // cumulative RECOMMENDED irrigation — series[].applied is set ONLY on days the
  // engine gated a trigger (a scheduled date where depletion crossed MAD). This is
  // the Bayesian analysis's denominator (applied ÷ recommendation), so it sums BOTH
  // Irrig and Fert triggered depths — NOT reference ET. Upper bound = 100% of that;
  // lower = 80% (the validated Target window at 35% MAD). Absent until the first
  // trigger (no recommendation yet = no band). Display-only, from /api/state.
  let reqCum = 0;

  const data = series.map((p, i) => {
    const rem = remainingOf(p);
    const isF = p.is_forecast;
    if (p.applied > 0) reqCum += p.applied; // all triggered applied (Irrig + Fert)
    const reqU = toDisplay(reqCum, unit);
    return {
      date: p.date,
      label: fmtDate(p.date),
      remActual: !isF ? rem : null,
      remForecast: isF || i === lastActualIdx ? rem : null, // bridge to last actual
      full: toDisplay(p.ad, unit),                          // full gauge = AD above trigger
      precip: toDisplay(p.precip, unit),
      applied: p.applied,
      isForecast: isF,
      reqBand: reqCum > 0 && reqU != null ? ([reqU * 0.8, reqU] as [number, number]) : null,
      reqUpper: reqCum > 0 ? reqU : null,
    };
  });
  const hasRequirement = reqCum > 0;

  const firstForecast = series.find((p) => p.is_forecast)?.date;
  const lastDate = series[series.length - 1]?.date;
  const projected = state.decision?.projected_trigger_date ?? null;
  const events = series
    .filter((p) => p.applied > 0)
    .map((p) => ({
      date: p.date,
      y: remainingOf(p),
      type: state.schedule.find((s) => s.date === p.date)?.type ?? "Irrig",
      amount: p.applied,
    }));

  if (!mounted) return <div className="h-[360px] w-full animate-pulse rounded-md bg-ink/[0.05]" />;

  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={data} margin={{ top: 14, right: 14, bottom: 4, left: 2 }}>
        <defs>
          <linearGradient id="remFill" x1="0" y1="0" x2="0" y2="1">
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
          domain={[(dataMin: number) => Math.min(0, dataMin), "auto"]}
          label={{ value: `water remaining (${unit})`, angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#6B7069", fontFamily: "var(--font-mono)" } }} />
        {hasRequirement && (
          <YAxis yAxisId="req" orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={44}
            domain={[0, "auto"]}
            label={{ value: `cum. recommended irrig · ${unit} (model-gated)`, angle: 90, position: "insideRight", style: { fontSize: 11, fill: "#6B7069", fontFamily: "var(--font-mono)" } }} />
        )}
        <Tooltip content={<ChartTip unit={unit} />} cursor={{ stroke: "#E7E5DF" }} />

        {/* requirement window — 80–100% of the engine's cumulative RECOMMENDED
            irrigation (model-gated triggers, Irrig + Fert); guardrails to stay
            within, not a setpoint; steps up on trigger days */}
        {hasRequirement && (
          <Area yAxisId="req" type="stepAfter" dataKey="reqBand" name="Recommended-irrigation window (80–100%)"
            stroke="var(--soil)" strokeOpacity={0.55} strokeWidth={1}
            fill="var(--soil)" fillOpacity={0.14} dot={false} isAnimationActive={false} connectNulls={false} />
        )}

        {/* trigger line: the gauge is empty here — irrigate when the line falls to it */}
        <ReferenceLine y={0} stroke="var(--status-now)" strokeWidth={1.5} strokeDasharray="5 4"
          label={{ value: "trigger line (empty)", position: "insideBottomRight", fontSize: 10, fill: "var(--status-now)", fontFamily: "var(--font-mono)" }} />

        {/* full mark = AD above the trigger (steps per stage) */}
        <Line type="stepAfter" dataKey="full" name="Full (AD)" stroke="var(--status-soon)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />

        {/* actual water remaining */}
        <Area type="monotone" dataKey="remActual" name="Water remaining" stroke="var(--brand)" strokeWidth={2.4} fill="url(#remFill)" dot={false} connectNulls={false} />

        {/* forecast water remaining */}
        <Line type="monotone" dataKey="remForecast" name="Forecast" stroke="var(--water)" strokeWidth={2.2} strokeDasharray="4 4" dot={false} connectNulls />

        {/* projected trigger crossing (line descends to the trigger) */}
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
  const rem = row?.remActual ?? row?.remForecast;
  const fmt = (v: number) => v.toFixed(unit === "in" ? 2 : 1);
  return (
    <div className="rounded-lg border border-hairline bg-card px-3 py-2 font-mono text-xs shadow-hero">
      <div className="mb-1 font-semibold text-ink">
        {label} {row?.isForecast && <span className="text-water">· forecast</span>}
      </div>
      <Row k="water remaining" v={rem != null ? `${fmt(rem)} ${unit}` : "—"} />
      <Row k="full (AD)" v={row?.full != null ? `${fmt(row.full)} ${unit}` : "—"} />
      {row?.reqBand ? <Row k="rec. irrig window (aim within)" v={`${fmt(row.reqBand[0])}–${fmt(row.reqBand[1])} ${unit}`} /> : null}
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
