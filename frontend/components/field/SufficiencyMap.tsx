"use client";

import { useEffect, useMemo, useState } from "react";
import { Grid3x3, CloudOff, Download, Info, Sparkles, RefreshCw } from "lucide-react";
import { useSatelliteTarget } from "@/lib/zones";
import {
  getZoneSufficiency, postZoneSiSummary, zoneSufficiencyExportUrl,
  type SiSummaryResult, type SufficiencyResponse,
} from "@/lib/field/api";
import CollapsibleCard from "./CollapsibleCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type Range = { start: string; end: string } | undefined;
type EngineContext = Record<string, unknown> | null;

const DEFAULT_THRESHOLD = 0.95;
const MIN_THRESHOLD = 0.8;

// Honest framing: relative WITHIN-field sufficiency from NDRE — flags zones to
// investigate. It is NOT a nitrogen prescription, and an internal reference
// cannot detect whole-field deficiency (only spatial variability).
export default function SufficiencyMap({
  range,
  engineContext = null,
}: {
  range: Range;
  engineContext?: EngineContext;
}) {
  const { target } = useSatelliteTarget();
  const [res, setRes] = useState<SufficiencyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);

  useEffect(() => {
    if (!target || range === undefined) return;
    let cancelled = false;
    setLoading(true);
    // threshold changes recompute client-side from the histogram — one fetch per zone+range.
    // The 95th-pct reference + bare-soil mask are computed over THIS zone's pixels.
    getZoneSufficiency(target.id, range, DEFAULT_THRESHOLD)
      .then((d) => !cancelled && setRes(d))
      .catch(() => !cancelled && setRes({ status: "unavailable", index: "NDRE", note: "Sufficiency map unavailable right now." }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, range?.start, range?.end]);

  // spatial AI summary — re-summarizes when the field, scene/range, or threshold
  // changes (threshold debounced so slider drags don't spam the endpoint)
  const [sum, setSum] = useState<SiSummaryResult | null>(null);
  const [sumLoading, setSumLoading] = useState(false);

  async function runSummary(force = false) {
    if (!target || range === undefined || res?.status !== "ok") return;
    setSumLoading(true);
    try {
      setSum(await postZoneSiSummary(target.id, { range, threshold, engine_context: engineContext ?? {} }, force));
    } catch {
      setSum({ status: "error", message: "Summary unavailable right now." });
    } finally {
      setSumLoading(false);
    }
  }

  useEffect(() => {
    if (!target || range === undefined || res?.status !== "ok") return;
    const t = window.setTimeout(() => runSummary(false), 700); // debounce slider drags
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, range?.start, range?.end, threshold, res?.scene_date, res?.status]);

  // % of field below the (adjustable) threshold, from the 0.01-wide SI histogram.
  // Compare INTEGER bin indices — (i+1)*0.01 <= t breaks on float artifacts
  // (95*0.01 = 0.9500…01 silently dropped the 0.94–0.95 bin, showing 82.0%
  // where the server's exact cropped figure was 84.7%).
  const pctBelow = useMemo(() => {
    const hist = res?.histogram;
    if (!hist || !hist.length) return res?.pct_below_threshold ?? null;
    const total = hist.reduce((a, b) => a + b, 0);
    if (!total) return null;
    const cutBin = Math.round(threshold * 100); // bins [i*0.01,(i+1)*0.01): include i+1 <= cutBin
    let below = 0;
    for (let i = 0; i < hist.length; i++) if (i + 1 <= cutBin) below += hist[i];
    return (below / total) * 100;
  }, [res, threshold]);

  if (!target) return null;

  return (
    <CollapsibleCard
      title={`Relative sufficiency (NDRE)${target ? ` · ${target.name}` : ""}`}
      subtitle="this zone vs its OWN reference · flags areas to investigate — not an N prescription"
      icon={Grid3x3}
      right={
        res?.status === "ok" && res.scene_date ? (
          <span className="hidden font-mono text-[11px] text-muted sm:inline">scene {res.scene_date}</span>
        ) : undefined
      }
    >
      {range === undefined || (loading && !res) ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : res?.status !== "ok" ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-hairline bg-soil-soft/20 py-10 text-center">
          <CloudOff className="h-6 w-6 text-muted" />
          <p className="max-w-md text-sm text-muted">
            {res?.note || "Not enough canopy / no recent scene — SI unavailable."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* readouts */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Reference NDRE" value={res.reference_ndre?.toFixed(3) ?? "—"} hint="95th percentile · in-field" />
            <Stat label="Scene date" value={res.scene_date ?? "—"} hint="latest cloud-free" />
            <Stat label="Threshold" value={threshold.toFixed(2)} hint="SI below = investigate" />
            <Stat
              label="Below threshold"
              value={pctBelow != null ? `${pctBelow.toFixed(1)}%` : "—"}
              hint="of cropped area"
              tone={pctBelow != null && pctBelow > 25 ? "warn" : undefined}
            />
          </div>

          {/* coverage: SI is computed over actively growing crop only */}
          {res.cropped_fraction != null && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: "rgb(140,143,138)" }} />
              SI computed over <span className="font-mono font-semibold text-ink/75">{Math.round(res.cropped_fraction * 100)}%</span> of
              the field — {Math.round((res.bare_fraction ?? 1 - res.cropped_fraction) * 100)}% bare/unplanted excluded
              (NDRE&nbsp;&lt;&nbsp;{res.bare_soil_cutoff ?? 0.2}, shown grey)
            </div>
          )}

          {/* threshold control */}
          <div className="flex items-center gap-3">
            <span className="stat-label shrink-0">Threshold</span>
            <input
              type="range"
              min={MIN_THRESHOLD}
              max={1}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              aria-label="Sufficiency threshold"
              className="h-1.5 w-full max-w-[260px] cursor-pointer accent-[var(--brand)]"
            />
            <span className="font-mono text-xs font-semibold tabular-nums text-ink">{threshold.toFixed(2)}</span>
            {threshold !== DEFAULT_THRESHOLD && (
              <button
                type="button"
                onClick={() => setThreshold(DEFAULT_THRESHOLD)}
                className="text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                reset {DEFAULT_THRESHOLD}
              </button>
            )}
          </div>

          {/* continuous heat map, clipped to the field polygon */}
          {res.png_base64 && (
            <div className="overflow-hidden rounded-lg border border-hairline bg-[#0c1a12]/90 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${res.png_base64}`}
                alt={`Sufficiency-index heat map for ${target.name}, scene ${res.scene_date}`}
                className="mx-auto max-h-[420px] w-auto max-w-full"
                style={{ imageRendering: "pixelated" }}
              />
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[11px] text-canvas/70">
                <span className="inline-flex items-center gap-2">
                  <span>low SI</span>
                  <span className="h-2 w-28 rounded-sm" style={{ background: "linear-gradient(90deg,#bf382b,#c9821f,#2e7d49)" }} />
                  <span>high SI (≈ reference)</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "rgb(140,143,138)" }} />
                  bare / not cropped
                </span>
              </div>
            </div>
          )}

          {/* export */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="stat-label">Download zones</span>
            <Button size="sm" variant="outline" asChild>
              <a href={zoneSufficiencyExportUrl(target.id, range, threshold, "geojson")} download>
                <Download className="h-3.5 w-3.5" />
                GeoJSON
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={zoneSufficiencyExportUrl(target.id, range, threshold, "shp")} download>
                <Download className="h-3.5 w-3.5" />
                Shapefile (.zip)
              </a>
            </Button>
            <span className="text-[11px] text-muted">5 classified zones · WGS84 · caveat included</span>
          </div>

          {/* honest framing */}
          <div className="flex items-start gap-1.5 rounded-lg bg-soil-soft/30 px-3 py-2 text-[11px] leading-relaxed text-muted">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Relative within-field sufficiency (pixel NDRE ÷ {res.reference_method ?? "95th-percentile reference"}).
              Zones below the threshold are places to <span className="font-medium text-ink/70">investigate</span> — low SI can
              reflect water, soil, or stand differences, not only nitrogen. An internal reference cannot detect
              whole-field deficiency. Cross-check against soil water before applying N.
            </span>
          </div>

          {/* spatial AI summary (same grounded architecture as the field summary) */}
          <div className="rounded-lg border border-hairline bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="water" className="gap-1"><Sparkles className="h-3 w-3" /> AI-generated</Badge>
                {sum?.status === "ok" && sum.generated_at && (
                  <span className="font-mono text-[11px] text-muted">
                    {sum.model} · {new Date(sum.generated_at).toLocaleString()}
                  </span>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => runSummary(true)} disabled={sumLoading}>
                <RefreshCw className={`h-3.5 w-3.5 ${sumLoading ? "animate-spin" : ""}`} />
                Regenerate
              </Button>
            </div>
            {sumLoading && !sum?.summary_text ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
              </div>
            ) : sum?.status === "ok" && sum.summary_text ? (
              <>
                <KeyPoints text={sum.summary_text} />
                <div className="mt-2 flex items-start gap-1.5 text-[10px] text-muted">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>Advisory spatial read of the SI numbers above — zones to investigate, not an N prescription.</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">{sum?.message || "Generating a spatial read of this map…"}</p>
            )}
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}

// Parse the model's "- point" lines into grid cells: up to 3 columns, wrapping
// to new rows as points fill (1 column on mobile). Falls back to prose if the
// reply isn't a clean list.
function KeyPoints({ text }: { text: string }) {
  const points = text
    .split("\n")
    .map((l) => l.trim().replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
  if (points.length < 2) {
    return <p className="text-sm leading-relaxed text-ink/85">{text}</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {points.map((p, i) => (
        <li key={i} className="flex items-start gap-2 rounded-lg border border-hairline bg-soil-soft/20 px-2.5 py-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-water" />
          <span className="text-[13px] leading-snug text-ink/85">{p}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-hairline bg-soil-soft/20 px-3 py-2">
      <div className="stat-label">{label}</div>
      <div
        className="mt-0.5 font-mono text-lg font-semibold tabular-nums"
        style={{ color: tone === "warn" ? "var(--status-soon)" : "var(--ink)" }}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-muted">{hint}</div>}
    </div>
  );
}
