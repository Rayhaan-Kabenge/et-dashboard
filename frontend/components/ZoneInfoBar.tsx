"use client";

import { Layers, MapPin, Wheat } from "lucide-react";
import type { StateResponse } from "@/lib/types";
import { useActiveZone } from "@/lib/zones";
import { useUnits, fmtDepth } from "@/lib/units";

// Active-zone context strip (ZONE scope). Shows which zone the requirement window
// below reflects — name, crop, area, and the zone's window status. Explicitly
// contrasts with the field-scope meter overlay further down. Drill-in changes
// THIS; the field meter is unchanged.
export default function ZoneInfoBar({ state }: { state: StateResponse }) {
  const { zone, zones } = useActiveZone();
  const { unit } = useUnits();
  if (!zone) return null;

  const d = state.decision;
  const now = d?.should_irrigate_now;
  const statusColor = now ? "var(--status-now)" : "var(--status-hold)";

  return (
    <div className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-brand">
        <Layers className="h-3 w-3" /> Zone view
      </span>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-lg font-semibold text-ink">{zone.name}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-soil-soft/50 px-2 py-0.5 font-mono text-[11px] text-soil-deep">
          <Wheat className="h-3 w-3" /> {zone.crop}
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted">
          <MapPin className="h-3 w-3" />
          {zone.area_acres != null ? `${zone.area_acres.toFixed(1)} ac` : "no drawn geometry"}
        </span>
      </div>

      <div className="sm:ml-auto sm:text-right">
        <div className="font-mono text-[11px] uppercase tracking-wide text-muted">this zone’s window</div>
        <div className="flex items-center gap-1.5 font-semibold" style={{ color: statusColor }}>
          <span className="h-2 w-2 rounded-full" style={{ background: statusColor }} />
          {d?.recommendation ?? "—"}
          {d?.headroom != null && (
            <span className="font-mono text-[11px] font-normal text-muted">· {fmtDepth(d.headroom, unit)} to trigger</span>
          )}
        </div>
      </div>

      <p className="basis-full font-mono text-[11px] text-ink/40 sm:pt-1">
        The requirement window below is <span className="text-ink/60">this zone</span>. The field pumping meter is
        whole-field (all {zones.length} zone{zones.length === 1 ? "" : "s"}) — drill-in doesn’t change it.
      </p>
    </div>
  );
}
