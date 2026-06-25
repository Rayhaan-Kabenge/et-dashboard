"use client";

import { Droplet, Droplets, CircleCheck, CircleDashed, ArrowDown } from "lucide-react";
import type { StateResponse } from "@/lib/types";
import { statusOf, STATUS_META, type Status } from "@/lib/decision";
import { useUnits, toDisplay, unitLabel } from "@/lib/units";
import { fmtDateLong } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { CountUp } from "@/components/CountUp";

const ICON: Record<Status, typeof Droplet> = {
  now: Droplet,
  soon: Droplets,
  hold: CircleCheck,
  none: CircleDashed,
};

export default function HeroBanner({ state }: { state: StateResponse }) {
  const { unit } = useUnits();
  const d = state.decision;
  if (!d) return null;
  const status = statusOf(d);
  const meta = STATUS_META[status];
  const Icon = ICON[status];

  const headroom = d.headroom; // ad - depletion (mm), already computed by the API
  const past = headroom != null && headroom < 0;
  const headroomLabel = status === "none" ? "AD not defined" : past ? "past AD" : "to AD";
  const headroomNumeric =
    status === "none" || headroom == null ? null : Math.abs(toDisplay(headroom, unit) as number);
  const decimals = unit === "in" ? 2 : 1;

  return (
    <section
      className="relative overflow-hidden rounded-xl2 border border-hairline bg-card shadow-hero"
      style={{ ["--s" as string]: meta.cssVar }}
      aria-label="Irrigation decision"
    >
      {/* status wash + left rail */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "var(--s)", opacity: 0.05 }} />
      <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: "var(--s)" }} />

      <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7 sm:pl-8">
        <div className="flex items-start gap-4">
          <span
            className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
            style={{ background: "color-mix(in srgb, var(--s) 14%, transparent)", color: "var(--s)" }}
          >
            <Icon className="h-6 w-6" strokeWidth={2.2} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]" style={{ color: "var(--s)" }}>
                {meta.label}
              </h2>
              <span className="text-2xl font-light text-hairline sm:text-[28px]">—</span>
              <span className="text-lg text-ink/75 sm:text-xl">{meta.sub.toLowerCase()}</span>
              {d.estimated && <Badge variant="soon">estimated</Badge>}
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span className="font-mono">{fmtDateLong(state.today?.date)}</span>
              <span className="text-hairline">·</span>
              <span>{d.recommendation}</span>
            </p>
          </div>
        </div>

        {/* headroom readout, points down to the meter */}
        <div className="flex items-end gap-4 sm:flex-col sm:items-end sm:gap-1">
          <div className="text-right">
            <div className="stat-label">{headroomLabel}</div>
            <div className="flex items-baseline justify-end gap-1.5">
              <span className="font-mono text-4xl font-semibold tabular-nums" style={{ color: "var(--s)" }}>
                {headroomNumeric == null ? "—" : <CountUp value={headroomNumeric} decimals={decimals} />}
              </span>
              {headroomNumeric != null && <span className="text-base text-muted">{unitLabel(unit)}</span>}
            </div>
          </div>
          <a
            href="#root-zone-meter"
            className="group inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink"
          >
            root-zone meter
            <ArrowDown className="h-3 w-3 transition-transform group-hover:translate-y-0.5" />
          </a>
        </div>
      </div>
    </section>
  );
}
