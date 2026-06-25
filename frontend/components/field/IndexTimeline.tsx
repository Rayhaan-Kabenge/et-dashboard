"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { Activity, CloudOff, LineChart as LineIcon } from "lucide-react";
import { useField } from "@/lib/field/context";
import { getIndices } from "@/lib/field/api";
import type { IndexSeries } from "@/lib/field/types";
import CollapsibleCard from "./CollapsibleCard";
import { Skeleton } from "@/components/ui/skeleton";

type StageMarker = { label: string; date: string };
type Preset = "season" | "30" | "60" | "90" | "custom";
const ANOMALY_DELTA: Record<string, number> = { NDRE: 0.07, NDVI: 0.1 };

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function IndexTimeline({
  stages,
  onRangeChange,
}: {
  stages: StageMarker[];
  onRangeChange?: (range: { start: string; end: string }) => void;
}) {
  const { field } = useField();
  const [index, setIndex] = useState<"NDRE" | "NDVI">("NDRE");
  const [preset, setPreset] = useState<Preset>("season");
  const seasonStart = stages[0]?.date ?? iso(new Date(new Date().getFullYear(), 0, 1));
  const today = iso(new Date());

  const [customStart, setCustomStart] = useState(seasonStart);
  const [customEnd, setCustomEnd] = useState(today);

  const { start, end } = useMemo(() => {
    const now = new Date();
    if (preset === "custom") return { start: customStart, end: customEnd };
    if (preset === "season") return { start: seasonStart, end: today };
    const days = Number(preset);
    const s = new Date(now);
    s.setDate(s.getDate() - days);
    return { start: iso(s), end: today };
  }, [preset, customStart, customEnd, seasonStart, today]);

  const [series, setSeries] = useState<IndexSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!field) return;
    let cancelled = false;
    setLoading(true);
    getIndices(field.id, index, start, end)
      .then((s) => !cancelled && (setSeries(s), setError(null)))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [field, index, start, end]);

  // report the selected range up so sibling panels (e.g. Latest image) can follow it
  useEffect(() => {
    onRangeChange?.({ start, end });
  }, [start, end, onRangeChange]);

  const data = useMemo(() => {
    const pts = series?.points ?? [];
    const delta = ANOMALY_DELTA[index] ?? 0.08;
    let prev: number | null = null;
    return pts.map((p) => {
      const anomaly = prev != null && prev - p.mean > delta;
      prev = p.mean;
      return {
        t: new Date(p.date).getTime(),
        date: p.date,
        mean: p.mean,
        band: [p.mean - p.stdev, p.mean + p.stdev] as [number, number],
        anomaly,
        valid_fraction: p.valid_fraction,
      };
    });
  }, [series, index]);

  const domain: [number, number] = [new Date(start).getTime(), new Date(end).getTime()];
  const stageLines = stages.filter((s) => s.date >= start && s.date <= end);
  const lastObs = series?.last_observation ?? null;
  const note = series?.note ?? null;

  return (
    <CollapsibleCard
      title="Index timeline"
      subtitle="Within-field mean ± 1σ · Sentinel-2"
      icon={LineIcon}
      right={
        <div className="flex items-center gap-2">
          {lastObs && (
            <span className="hidden items-center gap-1.5 font-mono text-[11px] text-muted sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-status-hold" />
              last {lastObs}
            </span>
          )}
          <div className="inline-flex rounded-full border border-hairline p-0.5 text-xs">
            {(["NDRE", "NDVI"] as const).map((ix) => (
              <button
                key={ix}
                onClick={() => setIndex(ix)}
                className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
                  index === ix ? "bg-brand text-canvas" : "text-muted hover:text-ink"
                }`}
              >
                {ix}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {/* range selector */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([["season", "Full season"], ["30", "30d"], ["60", "60d"], ["90", "90d"], ["custom", "Custom"]] as [Preset, string][]).map(
          ([p, label]) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                preset === p ? "border-brand bg-brand/10 text-brand" : "border-hairline text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          )
        )}
        {preset === "custom" && (
          <span className="flex items-center gap-1.5">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              className="h-7 rounded-md border border-hairline bg-card px-2 font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40" />
            <span className="text-muted">→</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              className="h-7 rounded-md border border-hairline bg-card px-2 font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40" />
          </span>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : error ? (
        <Empty icon={CloudOff} text={error} />
      ) : data.length === 0 ? (
        <Empty icon={CloudOff} text={note ?? "No imagery in this range."} />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand-accent)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--brand-accent)" stopOpacity={0.06} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" type="number" scale="time" domain={domain}
                tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                tick={{ fontSize: 10, fill: "#6B7069", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={{ stroke: "#E7E5DF" }} />
              <YAxis domain={[(d: number) => Math.min(0, d), (d: number) => Math.max(1, d)]} width={34}
                tick={{ fontSize: 10, fill: "#6B7069", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} />
              <Tooltip content={<TimelineTip index={index} />} />
              {stageLines.map((s) => (
                <ReferenceLine key={`${s.label}-${s.date}`} x={new Date(s.date).getTime()} stroke="var(--soil)" strokeDasharray="3 3" strokeWidth={1}
                  label={{ value: s.label, position: "insideTop", fontSize: 9, fill: "var(--soil-deep)", fontFamily: "var(--font-mono)" }} />
              ))}
              <Area type="monotone" dataKey="band" stroke="none" fill="url(#bandFill)" isAnimationActive={false} />
              <Line type="monotone" dataKey="mean" stroke="var(--brand)" strokeWidth={2} isAnimationActive={false}
                dot={(props: any) => {
                  const a = props.payload?.anomaly;
                  return (
                    <circle key={props.key} cx={props.cx} cy={props.cy} r={a ? 3.5 : 2}
                      fill={a ? "var(--status-now)" : "var(--brand)"} stroke="white" strokeWidth={a ? 1.5 : 0.5} />
                  );
                }} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: "var(--brand-accent)", opacity: 0.4 }} /> ±1σ within-field</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--status-now)" }} /> anomaly (drop &gt; {ANOMALY_DELTA[index]})</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5" style={{ background: "var(--soil)" }} /> stage date</span>
            <span>· {data.length} cloud-free obs</span>
          </div>
        </>
      )}
    </CollapsibleCard>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof CloudOff; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-hairline bg-soil-soft/20 py-10 text-center">
      <Icon className="h-6 w-6 text-muted" />
      <p className="max-w-sm text-sm text-muted">{text}</p>
    </div>
  );
}

function TimelineTip({ active, payload, index }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-hairline bg-card px-3 py-2 font-mono text-xs shadow-hero">
      <div className="mb-1 font-semibold text-ink">{row.date}{row.anomaly && <span className="ml-1.5 text-status-now">▼ anomaly</span>}</div>
      <Row k={index} v={row.mean.toFixed(3)} />
      <Row k="±1σ" v={`${row.band[0].toFixed(2)}–${row.band[1].toFixed(2)}`} />
      <Row k="valid" v={`${Math.round(row.valid_fraction * 100)}%`} />
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
