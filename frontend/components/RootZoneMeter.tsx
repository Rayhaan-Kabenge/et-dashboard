"use client";

import { Droplet, Droplets, CircleCheck, CircleDashed, CalendarClock, TrendingUp } from "lucide-react";
import type { StateResponse } from "@/lib/types";
import { statusOf, STATUS_META, type Status } from "@/lib/decision";
import { useUnits, fmtDepth, fmtDepthValue, unitLabel } from "@/lib/units";
import { fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

const ICON: Record<Status, typeof Droplet> = {
  now: Droplet,
  soon: Droplets,
  hold: CircleCheck,
  none: CircleDashed,
};

export default function RootZoneMeter({ state }: { state: StateResponse }) {
  const { unit } = useUnits();
  const d = state.decision;
  if (!d) return null;

  const dep = d.depletion;
  const ad = d.ad;
  const status = statusOf(d);
  const meta = STATUS_META[status];
  const Icon = ICON[status];
  const noAD = ad == null;

  // AD-relative scale (the engine does not expose total available water, so we do
  // NOT invent a TAW; we scale to AD with a little overflow room past the trigger).
  const scaleMax = noAD
    ? Math.max((dep ?? 1) * 1.3, 1)
    : Math.max(ad! * 1.2, (dep ?? 0) * 1.08, 1);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;

  const soilTo = noAD ? dep ?? 0 : Math.min(dep ?? 0, ad!);
  const overflow = noAD ? 0 : Math.max(0, (dep ?? 0) - ad!);
  const water = noAD ? 0 : Math.max(0, ad! - (dep ?? 0));
  const adPos = noAD ? 0 : (ad! / scaleMax) * 100;

  const past = !noAD && dep != null && dep > ad!;
  const headroomLabel = noAD ? "—" : past ? "past AD" : "to AD";

  return (
    <section
      id="root-zone-meter"
      className="scroll-mt-24 rounded-xl2 border border-hairline bg-card shadow-card"
      aria-label="Root-zone water meter"
    >
      <div className="flex flex-col gap-1 p-5 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="stat-label">Root zone · soil water</div>
          <h3 className="text-base font-semibold tracking-tight text-ink">Depletion vs allowable</h3>
        </div>
        <Badge variant={meta.badge} className="self-start text-[13px]">
          <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
          {meta.label}
        </Badge>
      </div>

      <div className="p-5 pt-3">
        {/* headline numbers */}
        <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="stat-label">Depletion</div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-4xl font-semibold tabular-nums" style={{ color: meta.cssVar }}>
                {fmtDepthValue(dep, unit)}
              </span>
              <span className="text-base text-muted">{unitLabel(unit)}</span>
            </div>
          </div>
          <div>
            <div className="stat-label">{noAD ? "Allowable (AD)" : "Allowable depletion"}</div>
            <div className="font-mono text-xl font-semibold tabular-nums text-ink/70">
              {noAD ? "not defined" : fmtDepth(ad, unit)}
            </div>
          </div>
          {!noAD && (
            <div>
              <div className="stat-label">{headroomLabel}</div>
              <div className="font-mono text-xl font-semibold tabular-nums" style={{ color: meta.cssVar }}>
                {fmtDepth(Math.abs(d.headroom ?? 0), unit)}
              </div>
            </div>
          )}
        </div>

        {/* the meter */}
        {noAD ? (
          <div className="rounded-lg border border-dashed border-hairline bg-soil-soft/40 px-4 py-5 text-sm text-muted">
            Allowable depletion is not defined at this growth stage — no irrigation threshold to plot.
          </div>
        ) : (
          <div>
            <div className="relative h-9 w-full overflow-hidden rounded-lg bg-soil-soft/60 ring-1 ring-inset ring-soil/10">
              {/* over-depletion zone (beyond AD) faint */}
              <div className="absolute inset-y-0 bg-ink/[0.03]" style={{ left: pct(ad!), right: 0 }} />
              {/* water remaining (blue) */}
              {water > 0 && (
                <div
                  className="absolute inset-y-0"
                  style={{
                    left: pct(soilTo),
                    width: pct(water),
                    background: "linear-gradient(180deg, color-mix(in srgb, var(--water) 78%, white), var(--water))",
                  }}
                />
              )}
              {/* depleted soil (left) with subtle horizons */}
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: pct(soilTo),
                  background:
                    "repeating-linear-gradient(180deg, var(--soil) 0 6px, color-mix(in srgb, var(--soil) 86%, black) 6px 7px), var(--soil)",
                }}
              />
              {/* overflow past AD (danger) */}
              {overflow > 0 && (
                <div
                  className="absolute inset-y-0"
                  style={{ left: pct(ad!), width: pct(overflow), background: "var(--status-now)" }}
                />
              )}
              {/* AD threshold tick */}
              <div className="absolute inset-y-0 z-10 w-0.5 bg-ink/70" style={{ left: `calc(${adPos}% - 1px)` }} />
            </div>

            {/* AD label aligned to tick */}
            <div className="relative mt-1 h-4">
              <div
                className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-[11px] font-medium text-ink/70"
                style={{ left: `${adPos}%` }}
              >
                ▲ AD {fmtDepth(ad, unit)}
              </div>
            </div>

            {/* legend */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--soil)" }} /> depleted
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--water)" }} /> available before trigger
              </span>
              {past && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--status-now)" }} /> past AD
                </span>
              )}
            </div>
          </div>
        )}

        {/* supporting readouts (existing computed values) */}
        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-hairline pt-4 sm:grid-cols-3">
          <Readout icon={CalendarClock} label="Days to trigger" value={d.days_to_trigger != null ? `${d.days_to_trigger}` : "—"} hint="at recent ET" />
          <Readout icon={CalendarClock} label="Projected trigger" value={d.projected_trigger_date ? fmtDate(d.projected_trigger_date, { month: "short", day: "numeric" }) : "beyond forecast"} hint="forecast crossing" />
          <Readout icon={TrendingUp} label="Recent ETc" value={d.recent_avg_etc != null ? fmtDepth(d.recent_avg_etc, unit) : "—"} hint="mean, last days" />
        </div>
      </div>
    </section>
  );
}

function Readout({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Droplet;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      <div>
        <div className="stat-label">{label}</div>
        <div className="font-mono text-base font-semibold tabular-nums text-ink">{value}</div>
        {hint && <div className="text-[11px] text-muted">{hint}</div>}
      </div>
    </div>
  );
}
