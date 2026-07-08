"use client";

import { useEffect, useMemo, useState } from "react";
import { Grid3x3, CloudOff, Download, Info } from "lucide-react";
import { useField } from "@/lib/field/context";
import { getSufficiency, sufficiencyExportUrl, type SufficiencyResponse } from "@/lib/field/api";
import CollapsibleCard from "./CollapsibleCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type Range = { start: string; end: string } | undefined;

const DEFAULT_THRESHOLD = 0.95;
const MIN_THRESHOLD = 0.8;

// Honest framing: relative WITHIN-field sufficiency from NDRE — flags zones to
// investigate. It is NOT a nitrogen prescription, and an internal reference
// cannot detect whole-field deficiency (only spatial variability).
export default function SufficiencyMap({ range }: { range: Range }) {
  const { field } = useField();
  const [res, setRes] = useState<SufficiencyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);

  useEffect(() => {
    if (!field || range === undefined) return;
    let cancelled = false;
    setLoading(true);
    // threshold changes recompute client-side from the histogram — one fetch per field+range
    getSufficiency(field.id, range, DEFAULT_THRESHOLD)
      .then((d) => !cancelled && setRes(d))
      .catch(() => !cancelled && setRes({ status: "unavailable", index: "NDRE", note: "Sufficiency map unavailable right now." }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field?.id, range?.start, range?.end]);

  // % of field below the (adjustable) threshold, from the 0.01-wide SI histogram
  const pctBelow = useMemo(() => {
    const hist = res?.histogram;
    if (!hist || !hist.length) return res?.pct_below_threshold ?? null;
    const total = hist.reduce((a, b) => a + b, 0);
    if (!total) return null;
    let below = 0;
    for (let i = 0; i < hist.length; i++) if ((i + 1) * 0.01 <= threshold) below += hist[i];
    return (below / total) * 100;
  }, [res, threshold]);

  if (!field) return null;

  return (
    <CollapsibleCard
      title="Relative sufficiency (NDRE)"
      subtitle="flags zones to investigate — not an N prescription"
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
                alt={`Sufficiency-index heat map for ${field.name}, scene ${res.scene_date}`}
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
              <a href={sufficiencyExportUrl(field.id, range, threshold, "geojson")} download>
                <Download className="h-3.5 w-3.5" />
                GeoJSON
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={sufficiencyExportUrl(field.id, range, threshold, "shp")} download>
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
        </div>
      )}
    </CollapsibleCard>
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
