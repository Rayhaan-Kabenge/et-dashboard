"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, TrendingUp, TrendingDown, Minus, CloudOff, Loader2, Droplets,
} from "lucide-react";
import { getZoneIndices } from "@/lib/field/api";
import { useSatelliteTarget } from "@/lib/zones";
import type { IndexSeries, IndexPoint, ETResponse } from "@/lib/field/types";
import CollapsibleCard from "./CollapsibleCard";
import { Skeleton } from "@/components/ui/skeleton";

type Range = { start: string; end: string } | undefined;
type IndexName = "NDRE" | "NDVI";

// Numbers-only readout. Surfaces values already computed by /indices and /et —
// no recomputation, no interpretation (no water/nutrient/stress attribution).
const PERIOD = 14;                                   // per-period normalisation (days)
const STABLE_DELTA: Record<IndexName, number> = { NDRE: 0.02, NDVI: 0.03 }; // window noise floor
const SIGMA_STABLE = 0.01;                           // σ-trend dead-band over the window

const MINUS = "−";
function signed(x: number, d = 2) {
  const v = Math.abs(x);
  if (v < 0.5 / 10 ** d) return (0).toFixed(d); // rounds to zero — drop the sign noise
  return (x < 0 ? MINUS : "+") + v.toFixed(d);
}
function shortDate(iso: string) {
  // parse the y-m-d as a LOCAL date so the scene date doesn't shift a day in
  // negative-UTC timezones (new Date("2026-06-18") is UTC midnight otherwise).
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function daysBetween(a: string, b: string) {
  return Math.max(0, Math.round((+new Date(b) - +new Date(a)) / 86_400_000));
}
function lsSlope(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return 0;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, x) => a + x * x, 0);
  const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const den = n * sxx - sx * sx;
  return den === 0 ? 0 : (n * sxy - sx * sy) / den; // units per day
}

type Stat = {
  n: number;
  latest: IndexPoint;
  hasTrend: boolean;
  delta?: number;
  perPeriod?: number;
  direction?: "rising" | "stable" | "falling";
  curvature?: "accelerating" | "decelerating" | null;
  latestSigma: number;
  sigmaDir?: "widening" | "narrowing" | "steady";
};

function summarize(points: IndexPoint[], index: IndexName): Stat | null {
  if (!points.length) return null;
  const latest = points[points.length - 1];
  if (points.length < 2) return { n: 1, latest, hasTrend: false, latestSigma: latest.stdev };

  const first = points[0];
  const span = Math.max(1, daysBetween(first.date, latest.date));
  const delta = latest.mean - first.mean;
  const perPeriod = (delta / span) * PERIOD;
  const direction = Math.abs(delta) < STABLE_DELTA[index] ? "stable" : delta > 0 ? "rising" : "falling";

  const t0 = +new Date(first.date);
  const xs = points.map((p) => (+new Date(p.date) - t0) / 86_400_000);

  // accelerating / decelerating — only when observations are dense enough to
  // support a second-derivative read, and only along a real (non-flat) trend.
  let curvature: Stat["curvature"] = null;
  if (points.length >= 8 && direction !== "stable") {
    const ys = points.map((p) => p.mean);
    const mid = Math.floor(points.length / 2);
    const early = lsSlope(xs.slice(0, mid + 1), ys.slice(0, mid + 1));
    const recent = lsSlope(xs.slice(mid), ys.slice(mid));
    const sgn = Math.sign(delta);
    if (Math.sign(early) === sgn && Math.sign(recent) === sgn) {
      const me = Math.abs(early), mr = Math.abs(recent);
      if (mr >= me * 1.3) curvature = "accelerating";
      else if (mr <= me * 0.7) curvature = "decelerating";
    }
  }

  // within-field σ trend over the window (least-squares, dead-banded)
  const sigSlope = lsSlope(xs, points.map((p) => p.stdev));
  const sigChange = sigSlope * span;
  const sigmaDir = Math.abs(sigChange) < SIGMA_STABLE ? "steady" : sigChange > 0 ? "widening" : "narrowing";

  return { n: points.length, latest, hasTrend: true, delta, perPeriod, direction, curvature, latestSigma: latest.stdev, sigmaDir };
}

export default function FieldStats({
  range,
  et,
  etLoading,
}: {
  range: Range;
  et: ETResponse | null;
  etLoading: boolean;
}) {
  const { target } = useSatelliteTarget();
  const [ndre, setNdre] = useState<IndexSeries | null>(null);
  const [ndvi, setNdvi] = useState<IndexSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target || range === undefined) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getZoneIndices(target.id, "NDRE", range.start, range.end),
      getZoneIndices(target.id, "NDVI", range.start, range.end),
    ])
      .then(([a, b]) => {
        if (cancelled) return;
        setNdre(a); setNdvi(b); setError(null);
      })
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load indices"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, range?.start, range?.end]);

  const stats = useMemo(
    () => ({ NDRE: summarize(ndre?.points ?? [], "NDRE"), NDVI: summarize(ndvi?.points ?? [], "NDVI") }),
    [ndre, ndvi]
  );

  const etStat = useMemo(() => {
    if (range === undefined) return null;
    const pts = (et?.et_actual ?? [])
      .filter((p) => p.date >= range.start && p.date <= range.end)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (pts.length === 0) {
      const outOfArea = et?.coverage === "out_of_area";
      return { available: false as const, outOfArea, note: et?.note ?? null };
    }
    const latest = pts[pts.length - 1];
    const cum = pts.reduce((a, p) => a + p.mm, 0);
    const provisional = et?.provisional_from != null && latest.date >= et.provisional_from;
    return { available: true as const, latestMm: latest.mm, latestDate: latest.date, cum, provisional };
  }, [et, range]);

  const noObs = !loading && !error && (stats.NDRE === null && stats.NDVI === null);

  return (
    <CollapsibleCard
      title={`At a glance${target ? ` · ${target.name}` : ""}`}
      subtitle="Latest values · trend · variability · ET — this zone · selected range"
      icon={LayoutDashboard}
      right={
        range && (
          <span className="hidden font-mono text-[11px] text-muted sm:inline">
            {range.start} → {range.end}
          </span>
        )
      }
    >
      {range === undefined || (loading && !ndre) ? (
        <Skeleton className="h-44 w-full rounded-lg" />
      ) : error ? (
        <Empty text={error} />
      ) : noObs ? (
        <Empty text={ndre?.note ?? "No cloud-free observations in this range."} />
      ) : (
        <div className="space-y-4">
          {/* 1 · latest index values */}
          <Section label="Latest index value">
            <div className="grid grid-cols-2 gap-3">
              <LatestTile index="NDRE" stat={stats.NDRE} />
              <LatestTile index="NDVI" stat={stats.NDVI} />
            </div>
          </Section>

          {/* 2 · trend over the selected range */}
          <Section label="Trend · selected range">
            <div className="space-y-1.5">
              <TrendRow index="NDRE" stat={stats.NDRE} />
              <TrendRow index="NDVI" stat={stats.NDVI} />
            </div>
          </Section>

          {/* 3 · within-field variability */}
          <Section label="Within-field variability (±1σ)">
            <div className="space-y-1.5">
              <VarRow index="NDRE" stat={stats.NDRE} />
              <VarRow index="NDVI" stat={stats.NDVI} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              narrowing = field changing uniformly · widening = increasingly patchy / uneven
            </p>
          </Section>

          {/* 4 · OpenET actual ET (Ensemble) */}
          <Section label="OpenET actual ET · Ensemble">
            <EtRows etStat={etStat} loading={etLoading && !et} />
          </Section>
        </div>
      )}
    </CollapsibleCard>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="stat-label mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function LatestTile({ index, stat }: { index: IndexName; stat: Stat | null }) {
  return (
    <div className="rounded-lg border border-hairline bg-soil-soft/20 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-brand">{index}</span>
        {stat ? (
          <span className="font-mono text-[11px] text-muted">as of {shortDate(stat.latest.date)}</span>
        ) : null}
      </div>
      <div className="mt-0.5 font-mono text-2xl font-semibold tracking-tight text-ink">
        {stat ? stat.latest.mean.toFixed(2) : "—"}
      </div>
    </div>
  );
}

function dirIcon(direction?: Stat["direction"]) {
  if (direction === "rising") return { Icon: TrendingUp, color: "var(--brand)", label: "rising" };
  if (direction === "falling") return { Icon: TrendingDown, color: "var(--soil)", label: "falling" };
  return { Icon: Minus, color: "var(--muted)", label: "stable" };
}

function TrendRow({ index, stat }: { index: IndexName; stat: Stat | null }) {
  if (!stat) return <Line2 index={index} body={<span className="text-muted">no observations</span>} />;
  if (!stat.hasTrend)
    return <Line2 index={index} body={<span className="text-muted">single observation — need ≥2 for a trend</span>} />;
  const { Icon, color, label } = dirIcon(stat.direction);
  return (
    <Line2
      index={index}
      body={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-sm">
          <span className="text-ink">Δ {signed(stat.delta!)}</span>
          <span className="text-muted">({signed(stat.perPeriod!)} / {PERIOD}d)</span>
          <span className="inline-flex items-center gap-1 font-medium" style={{ color }}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </span>
          {stat.curvature && (
            <span className="rounded-full bg-soil-soft/40 px-1.5 py-0.5 text-[11px] text-muted">{stat.curvature}</span>
          )}
        </div>
      }
    />
  );
}

function VarRow({ index, stat }: { index: IndexName; stat: Stat | null }) {
  if (!stat) return <Line2 index={index} body={<span className="text-muted">no observations</span>} />;
  const dir =
    stat.sigmaDir === "widening"
      ? { color: "var(--soil)", label: "widening" }
      : stat.sigmaDir === "narrowing"
      ? { color: "var(--brand)", label: "narrowing" }
      : { color: "var(--muted)", label: "steady" };
  return (
    <Line2
      index={index}
      body={
        <div className="flex flex-wrap items-center gap-x-3 font-mono text-sm">
          <span className="text-ink">σ {stat.latestSigma.toFixed(2)}</span>
          {stat.hasTrend ? (
            <span className="font-medium" style={{ color: dir.color }}>{dir.label}</span>
          ) : (
            <span className="text-muted">latest only</span>
          )}
        </div>
      }
    />
  );
}

function Line2({ index, body }: { index: IndexName; body: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 font-mono text-xs font-semibold text-brand">{index}</span>
      {body}
    </div>
  );
}

function EtRows({
  etStat,
  loading,
}: {
  etStat: { available: false; outOfArea?: boolean; note: string | null } | { available: true; latestMm: number; latestDate: string; cum: number; provisional?: boolean } | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-hairline bg-soil-soft/20 px-3 py-2.5 text-sm text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading OpenET…
      </div>
    );
  }
  if (!etStat || !etStat.available) {
    const text = etStat?.outOfArea
      ? "Field is outside OpenET coverage (western 23 US states)."
      : "OpenET actual ET not yet available.";
    return (
      <div
        title={(etStat && "note" in etStat && etStat.note) || undefined}
        className="flex items-center gap-2 rounded-lg border border-dashed border-hairline bg-soil-soft/20 px-3 py-2.5 text-sm text-muted"
      >
        <CloudOff className="h-4 w-4 shrink-0" /> {text}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg border border-hairline bg-water/5 px-3 py-2">
        <div className="flex items-center gap-1.5 stat-label">
          <Droplets className="h-3 w-3 text-water" /> Latest daily ET
        </div>
        <div className="mt-0.5 font-mono text-lg font-semibold text-ink">
          {etStat.latestMm.toFixed(1)} <span className="text-xs font-normal text-muted">mm/day</span>
        </div>
        <div className="font-mono text-[11px] text-muted">
          {shortDate(etStat.latestDate)}{etStat.provisional ? " · provisional" : ""}
        </div>
      </div>
      <div className="rounded-lg border border-hairline bg-water/5 px-3 py-2">
        <div className="stat-label">Cumulative · range</div>
        <div className="mt-0.5 font-mono text-lg font-semibold text-ink">
          {Math.round(etStat.cum)} <span className="text-xs font-normal text-muted">mm</span>
        </div>
        <div className="font-mono text-[11px] text-muted">actual ET (Ensemble)</div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-hairline bg-soil-soft/20 py-8 text-center text-sm text-muted">
      <CloudOff className="h-6 w-6" />
      {text}
    </div>
  );
}
