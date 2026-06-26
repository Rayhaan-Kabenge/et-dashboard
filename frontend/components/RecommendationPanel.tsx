"use client";

import { useState } from "react";
import { CalendarClock, Droplet, CloudRain, Sprout, Info } from "lucide-react";
import type { StateResponse } from "@/lib/types";
import { useUnits, fmtDepth } from "@/lib/units";
import { fmtDate } from "@/lib/format";
import CardChevron from "@/components/CardChevron";

// Pure display. Every value is read straight from /api/state — no water-balance
// math, no engine changes. These are forward-looking, ADVISORY reads on the
// engine's own forecast projection; the engine's decision + schedule (shown above)
// remain authoritative. All quantities are mm in the payload — fmtDepth respects
// the mm⇄in toggle.
export default function RecommendationPanel({ state }: { state: StateResponse }) {
  const { unit } = useUnits();
  const [open, setOpen] = useState(true);
  const d = state.decision;
  if (!d) return null;

  // Forecast precip is CONTEXT ONLY — it is already credited into the engine's
  // projected depletion / trigger date. We sum it to inform, never to adjust.
  const forecastDays = state.series.filter((p) => p.is_forecast);
  const precipVals = forecastDays.map((p) => p.precip).filter((v): v is number => v != null);
  const precipSum = precipVals.length ? precipVals.reduce((a, b) => a + b, 0) : null;
  const nDays = forecastDays.length;

  const dtt = d.days_to_trigger;
  const relative = dtt != null ? `~${Math.round(dtt)} day${Math.round(dtt) === 1 ? "" : "s"}` : null;

  return (
    <section className="rounded-xl2 border border-hairline bg-card shadow-card" aria-label="Irrigation recommendations">
      <div className="flex items-center justify-between gap-2 p-5 pb-2">
        <div className="flex items-center gap-2">
          <CardChevron open={open} onClick={() => setOpen((o) => !o)} label="Recommendations" />
          <div>
            <div className="stat-label">What to do next</div>
            <h3 className="text-base font-semibold tracking-tight text-ink">Recommendations</h3>
          </div>
        </div>
        <span className="self-start rounded-full border border-hairline bg-soil-soft/40 px-2 py-0.5 text-[11px] font-medium text-muted">
          advisory · forecast projection
        </span>
      </div>

      {open && (<>
      <div className="grid grid-cols-1 gap-3 p-5 pt-3 sm:grid-cols-2">
        {/* 1 · irrigate-by — advisory projection, deferring to the engine's call */}
        <Tile icon={CalendarClock} label="Irrigate-by (projected)">
          {d.should_irrigate_now ? (
            <Body main="At the trigger now" sub="The engine's decision above is the call." />
          ) : d.projected_trigger_date ? (
            <Body
              main={`Around ${fmtDate(d.projected_trigger_date, { month: "short", day: "numeric" })}`}
              sub={`On current forecast — trending toward trigger${relative ? ` · ${relative} out` : ""}`}
            />
          ) : (
            <Body main="—" sub="No trigger within the forecast — not in active season." muted />
          )}
        </Tile>

        {/* 2 · refill-to-field-capacity amount */}
        <Tile icon={Droplet} label="Refill to field capacity">
          {d.depletion != null ? (
            <Body
              main={`Apply ~${fmtDepth(d.depletion, unit)}`}
              sub={
                d.headroom != null
                  ? `${fmtDepth(Math.max(0, d.headroom), unit)} buffer before MAD`
                  : "to refill the root zone"
              }
            />
          ) : (
            <Body main="—" sub="depletion unavailable" muted />
          )}
        </Tile>

        {/* 3 · forecast precip — CONTEXT, never an adjustment */}
        <Tile icon={CloudRain} label="Forecast rain (context)">
          {precipSum != null && precipSum >= 0.05 ? (
            <Body
              main={`~${fmtDepth(precipSum, unit)} next ${nDays} days`}
              sub="Already factored into the projection above."
            />
          ) : precipSum != null ? (
            <Body main="No measurable rain" sub={`forecast next ${nDays} days · factored in`} muted />
          ) : (
            <Body main="—" sub="no forecast precip" muted />
          )}
        </Tile>

        {/* 4 · daily crop water-use rate (bonus) */}
        <Tile icon={Sprout} label="Crop water use">
          {d.recent_avg_etc != null ? (
            <Body main={`~${fmtDepth(d.recent_avg_etc, unit)}/day`} sub="recent crop ET" />
          ) : (
            <Body main="—" sub="not in active season" muted />
          )}
        </Tile>
      </div>

      <div className="flex items-start gap-1.5 border-t border-hairline px-5 py-2.5 text-[11px] text-muted">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          Forward-looking projections from the engine&apos;s forecast. The decision and schedule above are the
          engine&apos;s authoritative call.
        </span>
      </div>
      </>)}
    </section>
  );
}

function Tile({ icon: Icon, label, children }: { icon: typeof Droplet; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hairline bg-soil-soft/20 p-3">
      <div className="mb-1 flex items-center gap-1.5 stat-label">
        <Icon className="h-3.5 w-3.5 text-water" />
        {label}
      </div>
      {children}
    </div>
  );
}

function Body({ main, sub, muted }: { main: string; sub?: string; muted?: boolean }) {
  return (
    <div>
      <div className={`font-mono text-lg font-semibold tabular-nums ${muted ? "text-muted" : "text-ink"}`}>{main}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-muted">{sub}</div>}
    </div>
  );
}
