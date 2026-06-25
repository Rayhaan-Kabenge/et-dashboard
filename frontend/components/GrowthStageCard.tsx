"use client";

import { useState } from "react";
import type { StateResponse } from "@/lib/types";
import CornIllustration from "./CornIllustration";
import { resolveStageImage } from "@/lib/stageImage";
import { fmtNum } from "@/lib/format";

export default function GrowthStageCard({ state }: { state: StateResponse }) {
  const g = state.growth_stage;
  if (!g) return null;

  // build the stage rail from the series (distinct stage labels in order)
  const stageOrder: string[] = [];
  for (const p of state.series) {
    if (p.stage && !stageOrder.includes(p.stage)) stageOrder.push(p.stage);
  }
  const currentIdx = stageOrder.indexOf(g.stage);
  const photoSrc = resolveStageImage(g.stage, stageOrder);

  return (
    <section className="card flex flex-col p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="stat-label">Growth stage</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-2xl font-bold text-leaf-700">{g.stage}</span>
            {g.estimated && (
              <span
                className="chip bg-amber-400/15 text-amber-500 !px-2 !py-0.5 text-[11px]"
                title="Open interval — the next stage date is estimated from average stage lengths until you log the real one."
              >
                open · est.
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="stat-label">Day after planting</div>
          <div className="stat-value">{g.dap}</div>
        </div>
      </div>

      <div className="my-2 flex items-center justify-center">
        <StageVisual src={photoSrc} stage={g.stage} progress={g.season_progress} />
      </div>

      {/* stage rail */}
      <div className="mb-4">
        <div className="flex items-center gap-1">
          {stageOrder.map((s, i) => (
            <div key={s} className="flex flex-1 flex-col items-center gap-1">
              <div className={`h-1.5 w-full rounded-full ${i <= currentIdx ? "bg-leaf-500" : "bg-black/10"}`} />
              <span className={`text-[10px] font-medium ${i === currentIdx ? "text-leaf-700" : "text-ink/40"}`}>{s}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-black/5 pt-4">
        <Stat label="∑ GDD" value={fmtNum(g.cumgdd, 0)} />
        <Stat label="Kcr" value={fmtNum(g.kcr, 2)} />
        <Stat label="Interval progress" value={`${Math.round(g.progress * 100)}%`} />
        <Stat label="Season progress" value={`${Math.round(g.season_progress * 100)}%`} />
      </div>
    </section>
  );
}

// Stage photo with graceful fallback to the generated illustration on load error.
function StageVisual({ src, stage, progress }: { src: string | null; stage: string; progress: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <CornIllustration progress={progress} />;
  return (
    <div className="flex h-44 items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Corn at stage ${stage}`}
        onError={() => setFailed(true)}
        className="h-44 w-auto max-w-full rounded-xl object-contain"
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}
