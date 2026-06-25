"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Satellite, MapPinned } from "lucide-react";
import { FIELD_HEALTH_ENABLED } from "@/lib/features";

export default function FieldHealthPage() {
  const router = useRouter();
  useEffect(() => {
    if (!FIELD_HEALTH_ENABLED) router.replace("/");
  }, [router]);
  if (!FIELD_HEALTH_ENABLED) return null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-hairline bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:px-8">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl2 bg-water/10 text-water">
            <Satellite className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[17px] font-semibold leading-tight tracking-tight text-ink">Field Health</h1>
            <p className="font-mono text-[11px] text-muted">Sentinel-2 vegetation indices · NDRE / NDVI</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
        <div className="flex flex-col items-center justify-center rounded-xl2 border border-dashed border-hairline bg-card p-12 text-center">
          <MapPinned className="h-8 w-8 text-muted" />
          <h2 className="mt-3 text-base font-semibold text-ink">No field selected</h2>
          <p className="mt-1 max-w-sm text-sm text-muted">
            Draw a field on the map or upload a GeoJSON polygon to begin. (Map + panels arrive next.)
          </p>
        </div>
      </main>
    </div>
  );
}
