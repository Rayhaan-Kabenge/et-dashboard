"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Droplets, TriangleAlert, CheckCircle2, CloudOff } from "lucide-react";
import { useField } from "@/lib/field/context";
import { getEt } from "@/lib/field/api";
import type { ETResponse } from "@/lib/field/types";
import CollapsibleCard from "./CollapsibleCard";
import { Skeleton } from "@/components/ui/skeleton";

type EtcDaily = { date: string; etc: number | null };
type Range = { start: string; end: string } | undefined;

function cumulate(points: { date: string; mm: number }[]) {
  let acc = 0;
  return points.map((p) => ({ date: p.date, cum: (acc += p.mm) }));
}

export default function ETOverlay({ etcDaily, range }: { etcDaily: EtcDaily[]; range: Range }) {
  const { field } = useField();
  const [et, setEt] = useState<ETResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!field || range === undefined) return;
    let cancelled = false;
    setLoading(true);
    getEt(field.id, range)
      .then((d) => !cancelled && setEt(d))
      .catch(() => !cancelled && setEt(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [field, range?.start, range?.end, range]);

  const { data, modeledEnd, actualEnd, provFrom, note, coverage } = useMemo(() => {
    if (range === undefined) return { data: [] as any[], modeledEnd: 0, actualEnd: 0, provFrom: null as string | null, note: null as string | null, coverage: "ok" };
    const inRange = (d: string) => d >= range.start && d <= range.end;

    const modeled = cumulate(
      etcDaily.filter((p) => p.etc != null && inRange(p.date)).map((p) => ({ date: p.date, mm: p.etc as number }))
    );
    const actual = cumulate((et?.et_actual ?? []).filter((p) => inRange(p.date)).map((p) => ({ date: p.date, mm: p.mm })));
    const provFrom = et?.provisional_from ?? null;

    const byDate = new Map<string, any>();
    for (const m of modeled) byDate.set(m.date, { ...(byDate.get(m.date) || { date: m.date }), modeled: m.cum });
    for (const a of actual) {
      const prov = provFrom != null && a.date >= provFrom;
      const row = byDate.get(a.date) || { date: a.date };
      row.actualObs = prov ? null : a.cum;
      row.actualProv = prov ? a.cum : null;
      byDate.set(a.date, row);
    }
    // bridge solid->dashed at the provisional boundary so the dashed line connects
    const sorted = [...byDate.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
    let lastObsIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].actualObs != null) lastObsIdx = i;
      if (sorted[i].actualProv != null) {
        if (lastObsIdx >= 0 && sorted[lastObsIdx].actualProv == null) {
          sorted[lastObsIdx].actualProv = sorted[lastObsIdx].actualObs;
        }
        break;
      }
    }
    const data = sorted.map((r) => ({ ...r, t: new Date(r.date).getTime() }));
    return {
      data,
      modeledEnd: modeled.length ? modeled[modeled.length - 1].cum : 0,
      actualEnd: actual.length ? actual[actual.length - 1].cum : 0,
      provFrom,
      note: et?.note ?? null,
      coverage: et?.coverage ?? "ok",
    };
  }, [etcDaily, et, range]);

  const hasActual = actualEnd > 0;
  const gapPct = hasActual && modeledEnd > 0 ? ((modeledEnd - actualEnd) / modeledEnd) * 100 : null;

  return (
    <CollapsibleCard
      title="ET overlay"
      subtitle="Modeled crop demand (ETc) vs OpenET actual ET · cumulative mm"
      icon={Droplets}
    >
      {range === undefined || (loading && !et) ? (
        <Skeleton className="h-56 w-full rounded-lg" />
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-hairline bg-soil-soft/20 py-8 text-center text-sm text-muted">
          <CloudOff className="h-6 w-6" />
          No modeled ETc in this range.
        </div>
      ) : (
        <>
          {/* gap read-out */}
          <GapReadout coverage={coverage} hasActual={hasActual} gapPct={gapPct} note={note} provFrom={provFrom} />

          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={data} margin={{ top: 8, right: 14, bottom: 4, left: 4 }}>
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]}
                tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                tick={{ fontSize: 10, fill: "#6B7069", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={{ stroke: "#E7E5DF" }} />
              <YAxis width={40} tick={{ fontSize: 10, fill: "#6B7069", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false}
                label={{ value: "cum mm", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "#6B706699", fontFamily: "var(--font-mono)" } }} />
              <Tooltip content={<EtTip />} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: "var(--font-mono)" }} iconType="plainline" />
              <Line name="Modeled demand (ETc)" type="monotone" dataKey="modeled" stroke="var(--soil)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              <Line name="OpenET actual ET" type="monotone" dataKey="actualObs" stroke="var(--water)" strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls />
              <Line name="actual (provisional)" type="monotone" dataKey="actualProv" stroke="var(--water)" strokeWidth={2.2} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls legendType="none" />
            </ComposedChart>
          </ResponsiveContainer>
        </>
      )}
    </CollapsibleCard>
  );
}

function GapReadout({ coverage, hasActual, gapPct, note, provFrom }: any) {
  if (coverage === "out_of_area") {
    return <Banner icon={CloudOff} tone="muted" text="Field is outside OpenET coverage (western 23 US states)." />;
  }
  if (!hasActual) {
    // clean message; raw service note available on hover for debugging
    const clean =
      note && /OPENET_API_KEY/i.test(note)
        ? "Add an OpenET API key to enable the actual-ET overlay."
        : "OpenET actual ET isn’t available for this range yet — showing modeled demand only.";
    return <Banner icon={CloudOff} tone="muted" text={clean} title={note || undefined} />;
  }
  const pct = Math.round(gapPct);
  if (gapPct > 15) {
    return <Banner icon={TriangleAlert} tone="soon" text={`Actual ET tracking ~${pct}% below modeled demand — possible water stress.`} />;
  }
  if (gapPct < -10) {
    return <Banner icon={CheckCircle2} tone="hold" text={`Actual ET ~${Math.abs(pct)}% above modeled demand over this range.`} />;
  }
  return <Banner icon={CheckCircle2} tone="hold" text="Actual ET ≈ modeled demand — well watered." />;
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

function EtTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const actual = row?.actualObs ?? row?.actualProv;
  return (
    <div className="rounded-lg border border-hairline bg-card px-3 py-2 font-mono text-xs shadow-hero">
      <div className="mb-1 font-semibold text-ink">{row?.date}{row?.actualProv != null && <span className="ml-1 text-water">· provisional</span>}</div>
      <Row k="modeled ETc" v={row?.modeled != null ? `${row.modeled.toFixed(0)} mm` : "—"} />
      <Row k="actual ET" v={actual != null ? `${actual.toFixed(0)} mm` : "—"} />
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
