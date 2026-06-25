"use client";

import type { StateResponse } from "@/lib/types";
import { useUnits, fmtDepth, toDisplay } from "@/lib/units";
import { fmtDateLong } from "@/lib/format";

export default function DecisionCard({ state }: { state: StateResponse }) {
  const { unit } = useUnits();
  const d = state.decision;
  if (!d) return null;

  const dep = d.depletion;
  const ad = d.ad;
  const irrigate = d.should_irrigate_now;
  const pct = dep !== null && ad ? Math.min(1.4, dep / ad) : 0; // fraction of AD (cap for display)
  const fillPct = Math.min(100, (pct / 1.4) * 100);
  const adMarkPct = (1 / 1.4) * 100; // AD threshold sits at 1.0 of the 0..1.4 scale

  const accent = irrigate ? "clay" : pct >= 0.85 ? "amber" : "leaf";
  const barColor =
    accent === "clay" ? "bg-clay-500" : accent === "amber" ? "bg-amber-500" : "bg-leaf-500";
  const ringColor =
    accent === "clay" ? "text-clay-500" : accent === "amber" ? "text-amber-500" : "text-leaf-600";

  return (
    <section className="card overflow-hidden shadow-hero">
      <div className="grid gap-0 lg:grid-cols-[1.1fr_1fr]">
        {/* left — the call */}
        <div className="flex flex-col justify-between gap-6 p-6 lg:p-8">
          <div>
            <div className="flex items-center gap-2">
              <div className="stat-label">Irrigation decision · {fmtDateLong(state.today?.date)}</div>
              {d.estimated && (
                <span
                  className="chip bg-amber-400/15 text-amber-500 !px-2 !py-0.5 text-[11px]"
                  title="The current growth stage is still open, so Kcr/ETc and the projection use estimated upcoming stage dates. They sharpen as real dates are logged in the sheet."
                >
                  estimated
                </span>
              )}
            </div>
            <div className={`mt-2 flex items-center gap-3`}>
              <span className={`flex h-12 w-12 items-center justify-center rounded-full bg-current/10 ${ringColor}`}>
                {irrigate ? (
                  <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current">
                    <path d="M12 2c3.5 4.5 7 8 7 12a7 7 0 1 1-14 0c0-4 3.5-7.5 7-12Z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-current" strokeWidth={2.2}>
                    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <h2 className={`text-3xl font-bold tracking-tight ${ringColor}`}>
                {irrigate ? "Irrigate today" : "Hold"}
              </h2>
            </div>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink/70">{d.recommendation}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label="Days to trigger" value={d.days_to_trigger !== null ? `${d.days_to_trigger}` : "—"} hint="at recent ET" />
            <Metric
              label="Projected trigger"
              value={d.projected_trigger_date ? fmtDateLong(d.projected_trigger_date).replace(/,.*/, "") : "beyond forecast"}
              hint={d.projected_trigger_date ? "forecast crossing" : `next ${state.series.filter((s) => s.is_forecast).length}d`}
            />
            <Metric label="Headroom" value={fmtDepth(d.headroom, unit)} hint="AD − depletion" />
          </div>
        </div>

        {/* right — the gauge */}
        <div className="flex flex-col justify-center gap-4 border-t border-black/5 bg-leaf-50/40 p-6 lg:border-l lg:border-t-0 lg:p-8">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="stat-label">Root-zone depletion</div>
              <div className={`text-3xl font-bold tabular-nums ${ringColor}`}>{fmtDepth(dep, unit)}</div>
            </div>
            <div className="text-right">
              <div className="stat-label">Allowable (AD)</div>
              <div className="text-xl font-semibold tabular-nums text-ink/70">{fmtDepth(ad, unit)}</div>
            </div>
          </div>

          {/* gauge bar 0 .. 1.4×AD with AD threshold marker */}
          <div className="relative">
            <div className="h-5 w-full overflow-hidden rounded-full bg-soil-400/20">
              <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${fillPct}%` }} />
            </div>
            {/* AD threshold */}
            <div className="absolute top-0 flex h-5 flex-col items-center" style={{ left: `${adMarkPct}%` }}>
              <div className="h-7 w-0.5 -translate-y-1 bg-ink/60" />
            </div>
            <div className="absolute -bottom-5 -translate-x-1/2 text-[11px] font-medium text-ink/60" style={{ left: `${adMarkPct}%` }}>
              AD
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-ink/50">
            <span>0</span>
            <span>
              {dep !== null && ad ? `${Math.round((dep / ad) * 100)}% of AD used` : ""}
            </span>
            <span>{toDisplay(ad ? ad * 1.4 : null, unit)?.toFixed(unit === "in" ? 1 : 0) ?? ""}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="text-[11px] text-ink/40">{hint}</div>}
    </div>
  );
}
