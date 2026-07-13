"use client";

import { Layers } from "lucide-react";
import { useActiveZone } from "@/lib/zones";

// Zone selector — supersedes the old crop toggle. Picks the active zone by id
// (so it reaches same-crop zones and zones with no drawn geometry); stays in sync
// with map clicks (both call setActiveZone). A single-zone field shows a static
// label (drill-in is degenerate — nothing to pick).
export default function ZoneSelector() {
  const { zone, zones, setActiveZone } = useActiveZone();
  if (zones.length === 0) return null;

  if (zones.length === 1) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-card px-2.5 py-1 text-xs text-muted">
        <Layers className="h-3.5 w-3.5" />
        <span className="font-medium text-ink">{zones[0].name}</span>
        <span className="text-muted">· {zones[0].crop}</span>
      </div>
    );
  }

  return (
    <label className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-card px-2.5 py-1 text-xs">
      <Layers className="h-3.5 w-3.5 text-muted" aria-hidden />
      <span className="sr-only">Active zone</span>
      <select
        value={zone?.id ?? ""}
        onChange={(e) => setActiveZone(e.target.value)}
        aria-label="Active zone"
        className="bg-transparent font-medium text-ink focus:outline-none"
      >
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name} · {z.crop}
          </option>
        ))}
      </select>
    </label>
  );
}
