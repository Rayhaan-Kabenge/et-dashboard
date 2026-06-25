"use client";

import { useState } from "react";
import { ArrowRight, Wheat } from "lucide-react";
import type { StateResponse, StageInfo } from "@/lib/types";
import CornIllustration from "./CornIllustration";
import { resolveStageImage } from "@/lib/stageImage";
import { fmtNum, fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function GrowthStageCard({ state }: { state: StateResponse }) {
  const g = state.growth_stage;
  if (!g) return null;

  const stages = state.stages ?? [];
  const order = stages.map((s) => s.label);
  const currentIdx = stages.findIndex((s) => s.label === g.stage);
  const hasNext = currentIdx >= 0 && currentIdx < stages.length - 1;
  const next: StageInfo | null = hasNext ? stages[currentIdx + 1] : null;

  const today = state.today?.date;
  const daysToNext =
    next && today ? Math.max(0, Math.round((+new Date(next.date) - +new Date(today)) / 86400000)) : null;

  const curPhoto = resolveStageImage(g.stage, order.length ? order : [g.stage]);
  const nextPhoto = next ? resolveStageImage(next.label, order) : null;

  return (
    <section className="flex flex-col rounded-xl2 border border-hairline bg-card shadow-card">
      <div className="flex items-start justify-between p-5 pb-3">
        <div>
          <div className="stat-label">Growth stage</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-2xl font-semibold tracking-tight text-brand">{g.stage}</span>
            {g.estimated && <Badge variant="soon" className="px-2 py-0">open · est.</Badge>}
          </div>
        </div>
        <div className="text-right">
          <div className="stat-label">Day after planting</div>
          <div className="font-mono text-2xl font-semibold tabular-nums text-ink">{g.dap}</div>
        </div>
      </div>

      {/* current -> next preview */}
      <div className="px-5">
        {hasNext && next ? (
          <div className="flex items-center gap-3 rounded-lg border border-hairline bg-soil-soft/30 p-3">
            <StageVisual src={curPhoto} stage={g.stage} progress={g.season_progress} size="lg" />
            <ArrowRight className="h-5 w-5 shrink-0 text-muted" />
            <StageVisual src={nextPhoto} stage={next.label} progress={Math.min(1, g.season_progress + 0.1)} size="sm" muted />
            <div className="min-w-0">
              <div className="stat-label">Next</div>
              <div className="font-mono text-sm font-semibold text-ink">{next.label}</div>
              <div className="text-xs text-muted">
                {daysToNext != null ? `~${daysToNext} d` : "—"}
                {next.gdd != null ? ` · at ∑GDD ${fmtNum(next.gdd, 0)}` : ""}
                {next.kind === "provisional" ? " · est." : ""}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-hairline bg-soil-soft/30 p-3">
            <StageVisual src={curPhoto} stage={g.stage} progress={g.season_progress} size="lg" />
            <div className="flex items-center gap-2 text-sm text-soil-deep">
              <Wheat className="h-5 w-5" />
              <div>
                <div className="font-medium text-ink">Season complete</div>
                <div className="text-xs text-muted">Physiological maturity reached</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* stepper */}
      <div className="px-5 pt-4">
        <Stepper stages={stages} currentIdx={currentIdx} />
      </div>

      {/* stat strip */}
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-b-xl2 border-t border-hairline bg-hairline">
        <Stat label="∑ GDD" value={fmtNum(g.cumgdd, 0)} />
        <Stat label="Kcr" value={fmtNum(g.kcr, 2)} sparkline={<KcrSparkline state={state} />} />
        <Stat
          label="Interval progress"
          value={`${Math.round(g.progress * 100)}%`}
          meter={<Progress value={g.progress * 100} className="mt-1.5 h-1.5" />}
        />
        <Stat label="Season progress" value={`${Math.round(g.season_progress * 100)}%`} />
      </div>
    </section>
  );
}

function Stepper({ stages, currentIdx }: { stages: StageInfo[]; currentIdx: number }) {
  if (!stages.length) return null;
  const showLabels = stages.length <= 8;
  return (
    <TooltipProvider delayDuration={120}>
      <div className="relative">
        <div className="absolute left-2 right-2 top-[7px] h-px bg-hairline" />
        <div className="relative flex items-start justify-between gap-1">
          {stages.map((s, i) => {
            const done = i < currentIdx;
            const current = i === currentIdx;
            return (
              <Tooltip key={`${s.label}-${i}`}>
                <TooltipTrigger asChild>
                  <button className="flex min-w-0 flex-1 flex-col items-center gap-1 focus:outline-none">
                    <span
                      className={
                        current
                          ? "h-3.5 w-3.5 rounded-full bg-brand ring-4 ring-brand/15"
                          : done
                          ? "h-3 w-3 rounded-full bg-brand"
                          : "h-3 w-3 rounded-full border-2 border-hairline bg-card"
                      }
                    />
                    {showLabels && (
                      <span
                        className={`truncate font-mono text-[10px] ${
                          current ? "font-semibold text-brand" : "text-muted"
                        }`}
                      >
                        {s.label}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="font-mono text-[11px]">
                    <div className="font-semibold text-ink">{s.label}{s.kind === "provisional" ? " · est." : ""}</div>
                    <div className="text-muted">{fmtDate(s.date, { month: "short", day: "numeric", year: "numeric" })}</div>
                    {s.gdd != null && <div className="text-muted">∑GDD {fmtNum(s.gdd, 0)}</div>}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

function Stat({
  label,
  value,
  meter,
  sparkline,
}: {
  label: string;
  value: string;
  meter?: React.ReactNode;
  sparkline?: React.ReactNode;
}) {
  return (
    <div className="bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="stat-label">{label}</div>
        {sparkline}
      </div>
      <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-ink">{value}</div>
      {meter}
    </div>
  );
}

// Inline-SVG sparkline of the existing daily Kcr series (current point marked).
function KcrSparkline({ state }: { state: StateResponse }) {
  const pts = state.series.map((p) => p.kcr).filter((v): v is number => v != null);
  if (pts.length < 2) return null;
  const lastActualIdx =
    state.series.reduce((acc, p, i) => (!p.is_forecast && p.kcr != null ? i : acc), 0);
  // index within the filtered array of the last actual kcr
  let currentFilteredIdx = -1;
  {
    let f = -1;
    for (let i = 0; i < state.series.length; i++) {
      if (state.series[i].kcr != null) {
        f++;
        if (i === lastActualIdx) currentFilteredIdx = f;
      }
    }
  }
  const w = 64;
  const h = 18;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * h;
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const cx = currentFilteredIdx >= 0 ? x(currentFilteredIdx) : x(pts.length - 1);
  const cy = currentFilteredIdx >= 0 ? y(pts[currentFilteredIdx]) : y(pts[pts.length - 1]);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke="var(--brand-accent)" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={cx} cy={cy} r={2} fill="var(--brand)" stroke="white" strokeWidth={1} />
    </svg>
  );
}

// Stage photo with graceful fallback to the generated illustration on load error.
function StageVisual({
  src,
  stage,
  progress,
  size = "lg",
  muted = false,
}: {
  src: string | null;
  stage: string;
  progress: number;
  size?: "lg" | "sm";
  muted?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const box = size === "lg" ? "h-20 w-20" : "h-12 w-12";
  if (!src || failed) {
    return (
      <div className={`${box} shrink-0 ${muted ? "opacity-60" : ""}`}>
        <CornIllustration progress={progress} />
      </div>
    );
  }
  return (
    <div className={`${box} shrink-0 overflow-hidden rounded-lg border border-hairline bg-card ${muted ? "opacity-70 grayscale-[15%]" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`Corn at stage ${stage}`} onError={() => setFailed(true)} className="h-full w-full object-cover" />
    </div>
  );
}
