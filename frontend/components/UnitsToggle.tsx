"use client";

import { useUnits } from "@/lib/units";

export default function UnitsToggle() {
  const { unit, setUnit } = useUnits();
  return (
    <div className="inline-flex items-center rounded-full border border-black/10 bg-white p-0.5 text-sm">
      {(["mm", "in"] as const).map((u) => (
        <button
          key={u}
          onClick={() => setUnit(u)}
          className={`rounded-full px-3 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
            unit === u ? "bg-brand text-canvas shadow-sm" : "text-muted hover:text-ink"
          }`}
          aria-pressed={unit === u}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
