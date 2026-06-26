"use client";

import { useEffect, useState } from "react";
import { Wheat } from "lucide-react";
import { fetchCrops, type CropOption } from "@/lib/api";
import { useCrop } from "@/lib/crop";

// Corn ⇄ Sorghum toggle. Options come from /api/crops (server allow-list), so the
// frontend never hardcodes the crop list or any sheet id. Writes the choice to the
// URL via useCrop; both tabs read the same param and refetch /api/state.
export default function CropToggle() {
  const { crop, setCrop } = useCrop();
  const [crops, setCrops] = useState<CropOption[]>([{ id: "corn", label: "Corn" }]);

  useEffect(() => {
    let on = true;
    fetchCrops().then((c) => on && setCrops(c)).catch(() => {});
    return () => { on = false; };
  }, []);

  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-hairline bg-card p-0.5 text-xs"
      role="group"
      aria-label="Crop"
    >
      <Wheat className="ml-1 h-3.5 w-3.5 text-muted" aria-hidden />
      {crops.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => setCrop(c.id)}
          aria-pressed={crop === c.id}
          className={`rounded-full px-2.5 py-0.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
            crop === c.id ? "bg-brand text-canvas" : "text-muted hover:text-ink"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
