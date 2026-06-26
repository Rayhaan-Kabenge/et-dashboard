"use client";

import { useState } from "react";
import { Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import CardChevron from "@/components/CardChevron";

// v1 stub for the future Sentek pane: measured vs modeled depletion.
export default function SensorPane() {
  const [open, setOpen] = useState(true);
  return (
    <section className="relative overflow-hidden rounded-xl2 border border-hairline bg-card p-5 shadow-card">
      <div className="absolute right-4 top-4">
        <Badge variant="outline">coming soon</Badge>
      </div>
      <div className="flex items-center gap-2">
        <CardChevron open={open} onClick={() => setOpen((o) => !o)} label="field sensors" />
        <Radio className="h-5 w-5 text-soil-deep" />
        <h3 className="text-base font-semibold tracking-tight text-ink">Field sensors — Sentek</h3>
      </div>
      {open && (<>
      <p className="mt-1 max-w-prose text-sm text-muted">
        When a Sentek probe is connected, this pane will overlay <span className="font-medium text-ink">measured</span> root-zone
        depletion against the <span className="font-medium text-ink">modeled</span> balance — a ground-truth check on the engine.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {["10 cm", "30 cm", "60 cm"].map((d) => (
          <div key={d} className="rounded-lg border border-dashed border-hairline bg-soil-soft/30 p-4">
            <div className="stat-label">Probe @ {d}</div>
            <div className="mt-2 h-10 w-full rounded bg-gradient-to-r from-soil/15 to-transparent" />
            <div className="mt-2 font-mono text-[11px] text-muted">awaiting sensor feed</div>
          </div>
        ))}
      </div>
      </>)}
    </section>
  );
}
