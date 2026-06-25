"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Satellite } from "lucide-react";
import { FIELD_HEALTH_ENABLED } from "@/lib/features";
import { FieldProvider, useField } from "@/lib/field/context";
import { fetchState } from "@/lib/api";
import FieldMeta from "@/components/field/FieldMeta";
import IndexTimeline from "@/components/field/IndexTimeline";
import LatestImage from "@/components/field/LatestImage";
import { Skeleton } from "@/components/ui/skeleton";

// Stage markers come from the irrigation /api/state (frontend reuse only — the
// Field Health backend never calls the engine).
type StageMarker = { label: string; date: string };
function useStageMarkers(): StageMarker[] {
  const [stages, setStages] = useState<StageMarker[]>([]);
  useEffect(() => {
    fetchState()
      .then((s) => setStages((s.stages ?? []).map((x) => ({ label: x.label, date: x.date }))))
      .catch(() => setStages([]));
  }, []);
  return stages;
}

// Leaflet needs the browser — load the map client-side only.
const FieldMap = dynamic(() => import("@/components/field/FieldMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-[440px] w-full rounded-xl2" />,
});

export default function FieldHealthPage() {
  const router = useRouter();
  useEffect(() => {
    if (!FIELD_HEALTH_ENABLED) router.replace("/");
  }, [router]);
  if (!FIELD_HEALTH_ENABLED) return null;

  return (
    <FieldProvider>
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

        <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 lg:px-8 lg:py-8">
          <Body />
        </main>
      </div>
    </FieldProvider>
  );
}

function Body() {
  const { field, loading, error } = useField();
  const stages = useStageMarkers();
  return (
    <>
      {error && (
        <div className="rounded-lg border border-status-now/30 bg-status-now/[0.07] px-4 py-2 text-sm text-status-now">
          {error}
        </div>
      )}

      <FieldMap />

      {loading ? (
        <Skeleton className="h-20 w-full rounded-xl2" />
      ) : field ? (
        <>
          <FieldMeta />
          <IndexTimeline stages={stages} />
          <LatestImage />
          {/* field-summary panel arrives in the next stage */}
          <div className="rounded-xl2 border border-dashed border-hairline bg-card p-6 text-center text-sm text-muted">
            Field-summary panel arrives next.
          </div>
        </>
      ) : (
        <div className="rounded-xl2 border border-dashed border-hairline bg-card p-6 text-center text-sm text-muted">
          No field yet — draw one on the map (draw tool, top-left) or upload a GeoJSON polygon.
        </div>
      )}
    </>
  );
}
