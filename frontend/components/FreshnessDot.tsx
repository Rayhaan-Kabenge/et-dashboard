"use client";

import type { Freshness } from "@/lib/types";
import { fmtDate } from "@/lib/format";

// green: fresh; amber: aging; red: stale. Paired with a text label (a11y).
export default function FreshnessDot({ freshness, staleAfter = 2 }: { freshness: Freshness; staleAfter?: number }) {
  const days = freshness.days_since ?? 0;
  let color = "var(--status-hold)";
  let label = "Live";
  if (freshness.stale) {
    color = "var(--status-now)";
    label = "Stale";
  } else if (days >= staleAfter) {
    color = "var(--status-soon)";
    label = "Aging";
  }
  const title = `Last actual weather: ${fmtDate(freshness.last_actual_date, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} · ${days} day${days === 1 ? "" : "s"} ago`;

  return (
    <div className="inline-flex items-center gap-2" title={title}>
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping" style={{ background: color }} />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      </span>
      <span className="font-mono text-xs text-muted">
        {label} · {days}d
      </span>
    </div>
  );
}
