"use client";

// v1 stub for the future Sentek pane: measured vs modeled depletion.
export default function SensorPane() {
  return (
    <section className="card relative overflow-hidden p-6">
      <div className="absolute right-4 top-4 chip bg-black/5 text-ink/45 !px-2 !py-0.5 text-xs">coming soon</div>
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-soil-500 fill-none stroke-current" strokeWidth={2}>
          <path d="M12 2v6m0 0c-3 0-5 2-5 5v7h10v-7c0-3-2-5-5-5Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h3 className="text-lg font-semibold text-ink">Field sensors — Sentek</h3>
      </div>
      <p className="mt-1 max-w-prose text-sm text-ink/55">
        When a Sentek probe is connected, this pane will overlay <span className="font-medium text-ink/70">measured</span> root-zone
        depletion against the <span className="font-medium text-ink/70">modeled</span> balance — a ground-truth check on the engine.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {["10 cm", "30 cm", "60 cm"].map((d) => (
          <div key={d} className="rounded-lg border border-dashed border-black/10 bg-black/[0.015] p-4">
            <div className="stat-label">Probe @ {d}</div>
            <div className="mt-2 h-10 w-full rounded bg-gradient-to-r from-soil-400/15 to-transparent" />
            <div className="mt-2 text-xs text-ink/40">awaiting sensor feed</div>
          </div>
        ))}
      </div>
    </section>
  );
}
