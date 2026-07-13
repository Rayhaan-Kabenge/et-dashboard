"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Sprout, Info } from "lucide-react";
import type { Zone } from "@/lib/zones";
import {
  getRisk, metricCurves, metricDomain, confidenceOf, fmtVal,
  BAND_COLOR, BAND_ORDER, type RiskResponse, type Metric, type BandCurve,
} from "@/lib/risk";
import CardChevron from "@/components/CardChevron";

// Which metrics to surface, in order (Yield + Profit are the headline; IWUE if present).
const SHOW_METRICS = ["Yield", "Profit", "IWUE"];

/**
 * Per-zone risk panel — the risk ENVIRONMENT across the recommended-irrigation
 * window, from the pre-computed Bayesian posteriors. Advisory + relative, never a
 * prescription. Shows the three-zone (Below/Target/Above) skew-normal distributions
 * with honest credible intervals and n-based confidence. When the active zone's
 * crop isn't covered by any posterior, shows a clean "analysis pending" state
 * rather than mis-applying another crop's model.
 */
export default function RiskPanel({ zone }: { zone: Zone | null }) {
  const [open, setOpen] = useState(true);
  const [risk, setRisk] = useState<RiskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!zone) return;
    let on = true;
    setLoading(true);
    setError(null);
    getRisk(zone.id)
      .then((r) => on && setRisk(r))
      .catch((e) => on && setError(e?.message ?? "Failed to load risk model"))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [zone?.id]);

  const cropLabel = zone ? zone.name : "—";

  return (
    <div className="card p-6">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <CardChevron open={open} onClick={() => setOpen((o) => !o)} label="risk environment" />
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <ShieldAlert className="h-4 w-4 text-soil-deep" /> Risk environment
            </h3>
            <p className="text-sm text-ink/50">
              Outcome distributions across the recommended-irrigation window for the{" "}
              <span className="font-medium text-ink/70">{cropLabel}</span> zone — advisory, relative outcomes, not a prescription.
            </p>
          </div>
        </div>
        {risk?.model_crop && risk.status === "ok" && (
          <span className="hidden shrink-0 rounded-full bg-soil-soft/60 px-2.5 py-1 font-mono text-[11px] text-soil-deep sm:inline-block">
            risk model: {risk.model_crop}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-4">
          {loading || !zone ? (
            <div className="h-40 w-full animate-pulse rounded-md bg-ink/[0.05]" />
          ) : error ? (
            <div className="rounded-lg border border-status-soon/30 bg-status-soon/[0.08] px-4 py-3 text-sm text-status-soon">
              Risk model unavailable: {error}
            </div>
          ) : risk?.status !== "ok" ? (
            <PendingState risk={risk} />
          ) : (
            <RiskBody risk={risk} />
          )}
        </div>
      )}
    </div>
  );
}

// "analysis pending" — crop not covered by any posterior (no misapplication).
function PendingState({ risk }: { risk: RiskResponse | null }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-hairline bg-soil-soft/20 px-6 py-10 text-center">
      <Sprout className="h-6 w-6 text-soil/70" />
      <p className="text-sm font-medium text-ink/80">
        {risk?.message ?? "Risk model not yet available for this zone."}
      </p>
      <p className="max-w-md text-xs text-ink/45">
        The requirement window above still reflects this zone’s own recommended irrigation.
        A crop-specific posterior can be added later with no code change.
      </p>
    </div>
  );
}

function RiskBody({ risk }: { risk: RiskResponse }) {
  const obs = risk.zone_observations ?? {};
  const metrics = risk.metrics ?? {};
  const order = (risk.metric_display_order ?? SHOW_METRICS).filter((m) => SHOW_METRICS.includes(m) && metrics[m]);

  return (
    <div className="space-y-5">
      <p className="text-xs text-ink/55">
        Each band is a position in the window — <BandChip band="Below" obs={obs} /> (&lt;80%),{" "}
        <BandChip band="Target" obs={obs} /> (80–100%), <BandChip band="Above" obs={obs} /> (&gt;100%) of the
        cumulative recommended irrigation. The <span className="font-medium">width is the uncertainty</span> — wider bands are less certain.
      </p>

      {order.map((key) => (
        <MetricBlock key={key} name={key} metric={metrics[key]} obs={obs} />
      ))}

      {risk.caveats && risk.caveats.length > 0 && (
        <div className="rounded-lg border border-hairline bg-soil-soft/25 px-4 py-3">
          <div className="mb-1 flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wide text-soil-deep">
            <Info className="h-3.5 w-3.5" /> caveats
          </div>
          <ul className="list-disc space-y-1 pl-5 text-xs text-ink/60">
            {risk.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="font-mono text-[11px] text-ink/40">
        Risk model: {risk.source ?? "Bayesian TAPS"} · based on {risk.model_crop} data · display-only, no live computation.
      </p>
    </div>
  );
}

function BandChip({ band, obs }: { band: string; obs: Record<string, number> }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium" style={{ color: BAND_COLOR[band] }}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: BAND_COLOR[band] }} />
      {band}
    </span>
  );
}

// One metric: overlaid density lanes (Below/Target/Above) sharing an x-axis, each
// with its outcome spread (p05–p95, faint), 95% credible interval on the median
// (solid, widens with small n), and a median dot.
function MetricBlock({ name, metric, obs }: { name: string; metric: Metric; obs: Record<string, number> }) {
  const curves = metricCurves(metric);
  if (!curves.length) return null;
  const domain = metricDomain(curves);
  const units = metric.meta.units;

  // geometry (viewBox units; scales to container width)
  const W = 600;
  const gutter = 66;
  const plotL = gutter;
  const plotR = W - 14;
  const laneH = 46;
  const top0 = 6;
  const axisY = top0 + curves.length * laneH + 6;
  const H = axisY + 20;

  const sx = (v: number) => plotL + ((v - domain[0]) / (domain[1] - domain[0] || 1)) * (plotR - plotL);
  const byBand = Object.fromEntries(curves.map((c) => [c.band, c]));
  const laneOrder = BAND_ORDER.filter((b) => byBand[b]);

  const ticks = 4;
  const tickVals = Array.from({ length: ticks }, (_, i) => domain[0] + (i / (ticks - 1)) * (domain[1] - domain[0]));

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-ink">
          {metric.meta.label} <span className="font-normal text-ink/45">· {units}</span>
        </h4>
        <span className="font-mono text-[11px] text-ink/40">
          {metric.meta.higher_is_better ? "higher is better" : "lower is better"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`${metric.meta.label} distributions by irrigation zone`}>
        {laneOrder.map((band, li) => {
          const c = byBand[band] as BandCurve;
          const color = BAND_COLOR[band];
          const yTop = top0 + li * laneH;
          const base = yTop + laneH - 16; // density baseline; whisker sits below
          const dHeight = base - (yTop + 12);
          const sy = (v: number) => base - v * dHeight;
          const wy = yTop + laneH - 7; // whisker row
          const n = obs[band];
          const conf = confidenceOf(n);

          // density area path
          let d = `M ${sx(c.x[0]).toFixed(1)} ${base.toFixed(1)}`;
          c.x.forEach((xv, i) => (d += ` L ${sx(xv).toFixed(1)} ${sy(c.pdfNorm[i]).toFixed(1)}`));
          d += ` L ${sx(c.x[c.x.length - 1]).toFixed(1)} ${base.toFixed(1)} Z`;

          return (
            <g key={band}>
              {/* lane separator */}
              {li > 0 && <line x1={8} x2={W - 8} y1={yTop} y2={yTop} stroke="var(--hairline)" strokeWidth={1} />}
              {/* band label + confidence */}
              <text x={10} y={yTop + laneH / 2 - 2} fontSize={12} fontFamily="var(--font-mono)" fill={color} fontWeight={600}>
                {band}
              </text>
              <text x={10} y={yTop + laneH / 2 + 11} fontSize={8.5} fontFamily="var(--font-mono)" fill={conf.color}>
                {conf.label}
              </text>
              {/* density */}
              <path d={d} fill={color} fillOpacity={0.16} stroke={color} strokeOpacity={0.75} strokeWidth={1.4} />
              {/* outcome spread p05–p95 (faint, variability) */}
              <line x1={sx(c.p05)} x2={sx(c.p95)} y1={wy} y2={wy} stroke={color} strokeOpacity={0.3} strokeWidth={2} strokeLinecap="round" />
              {/* 95% credible interval on the median (solid; widens with small n) */}
              <line x1={sx(c.credLo)} x2={sx(c.credHi)} y1={wy} y2={wy} stroke={color} strokeOpacity={0.9} strokeWidth={3.5} strokeLinecap="round" />
              {/* median dot + label */}
              <circle cx={sx(c.median)} cy={wy} r={3.2} fill={color} stroke="white" strokeWidth={1.3} />
              <text x={sx(c.median)} y={yTop + 11} fontSize={9.5} fontFamily="var(--font-mono)" fill={color} textAnchor="middle">
                {fmtVal(c.median, units)}
              </text>
            </g>
          );
        })}
        {/* x-axis */}
        <line x1={plotL} x2={plotR} y1={axisY} y2={axisY} stroke="var(--hairline)" strokeWidth={1} />
        {tickVals.map((v, i) => (
          <g key={i}>
            <line x1={sx(v)} x2={sx(v)} y1={axisY} y2={axisY + 4} stroke="var(--hairline)" strokeWidth={1} />
            <text x={sx(v)} y={axisY + 15} fontSize={9} fontFamily="var(--font-mono)" fill="#6B7069"
              textAnchor={i === 0 ? "start" : i === ticks - 1 ? "end" : "middle"}>
              {fmtVal(v, units)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
