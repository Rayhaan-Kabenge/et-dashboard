"use client";

import type { Freshness } from "@/lib/types";
import { fmtDate } from "@/lib/format";

// green: fresh; amber: 1 day over threshold-ish; red: stale.
export default function FreshnessDot({ freshness, staleAfter = 2 }: { freshness: Freshness; staleAfter?: number }) {
  const days = freshness.days_since ?? 0;
  let color = "bg-leaf-500";
  let label = "Live";
  if (freshness.stale) {
    color = "bg-clay-500";
    label = "Stale";
  } else if (days >= staleAfter) {
    color = "bg-amber-500";
    label = "Aging";
  }
  const title = `Last actual weather: ${fmtDate(freshness.last_actual_date, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} · ${days} day${days === 1 ? "" : "s"} ago`;

  return (
    <div className="inline-flex items-center gap-2" title={title}>
      <span className={`relative flex h-2.5 w-2.5`}>
        <span className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-60 animate-ping`} />
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
      </span>
      <span className="text-sm text-ink/70">
        {label} · {days}d
      </span>
    </div>
  );
}
