"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Satellite } from "lucide-react";
import { FIELD_HEALTH_ENABLED } from "@/lib/features";
import { FieldProvider, useField } from "@/lib/field/context";
import { fetchState } from "@/lib/api";
import { useCrop } from "@/lib/crop";
import { getEt } from "@/lib/field/api";
import type { StateResponse } from "@/lib/types";
import type { ETResponse } from "@/lib/field/types";
import FieldMeta from "@/components/field/FieldMeta";
import IndexTimeline from "@/components/field/IndexTimeline";
import LatestImage from "@/components/field/LatestImage";
import SufficiencyMap from "@/components/field/SufficiencyMap";
import ETOverlay from "@/components/field/ETOverlay";
import ReferenceETCheck from "@/components/field/ReferenceETCheck";
import FieldSummary from "@/components/field/FieldSummary";
import FieldChat from "@/components/field/FieldChat";
import { Skeleton } from "@/components/ui/skeleton";

// The irrigation /api/state is fetched here on the FRONTEND and passed into the
// field panels as props (stage markers, daily modeled ETc, daily station ETr,
// decision context). The Field Health backend never calls the engine.
function useEngineState(crop: string): StateResponse | null {
  const [state, setState] = useState<StateResponse | null>(null);
  useEffect(() => {
    // engine overlays (stage markers, modeled ETc) follow the active crop;
    // the field, map, basemap, and NDRE/NDVI indices are crop-agnostic.
    fetchState(false, crop).then(setState).catch(() => setState(null));
  }, [crop]);
  return state;
}

// Shared OpenET fetch for the selected range — both ET panels read it (one call).
function useEt(fieldId: string | undefined, range: { start: string; end: string } | undefined) {
  const [et, setEt] = useState<ETResponse | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!fieldId || range === undefined) return;
    let cancelled = false;
    setLoading(true);
    getEt(fieldId, range)
      .then((d) => !cancelled && setEt(d))
      .catch(() => !cancelled && setEt(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fieldId, range?.start, range?.end]);
  return { et, loading };
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
  const { field, loading, error, cleared } = useField();
  const { crop } = useCrop();
  const engine = useEngineState(crop);
  const stages = (engine?.stages ?? []).map((x) => ({ label: x.label, date: x.date }));
  const etcDaily = (engine?.series ?? []).map((p) => ({ date: p.date, etc: p.etc }));
  const etrDaily = (engine?.series ?? []).map((p) => ({ date: p.date, etr: p.etr }));
  // the timeline owns the date-range selector; image + ET panels follow it.
  // undefined until the timeline reports; then { start, end }.
  const [imageRange, setImageRange] = useState<{ start: string; end: string } | undefined>(undefined);
  const { et, loading: etLoading } = useEt(field?.id, imageRange);

  // engine-side context for the AI summary — all from /api/state (frontend), incl.
  // the modeled cumulative ETc accumulated over the selected range.
  const modeledEtcCum =
    imageRange && engine
      ? etcDaily
          .filter((p) => p.etc != null && p.date >= imageRange.start && p.date <= imageRange.end)
          .reduce((a, p) => a + (p.etc as number), 0)
      : null;
  const engineContext = engine
    ? {
        stage: engine.growth_stage?.stage ?? null,
        dap: engine.growth_stage?.dap ?? engine.today?.dap ?? null,
        depletion_mm: engine.decision?.depletion ?? null,
        ad_mm: engine.decision?.ad ?? null,
        headroom_mm: engine.decision?.headroom ?? null,
        decision: engine.decision?.recommendation ?? null,
        modeled_etc_cum_mm: modeledEtcCum != null ? Math.round(modeledEtcCum * 10) / 10 : null,
      }
    : null;
  return (
    <>
      {error && (
        <div className="rounded-lg border border-status-now/30 bg-status-now/[0.07] px-4 py-2 text-sm text-status-now">
          {error}
        </div>
      )}

      <FieldMap
        siteCenter={
          engine?.site && engine.site.longitude != null
            ? [engine.site.latitude, engine.site.longitude]
            : null
        }
      />

      {loading ? (
        <Skeleton className="h-20 w-full rounded-xl2" />
      ) : field ? (
        <>
          <FieldMeta />
          <IndexTimeline stages={stages} onRangeChange={setImageRange} />
          <LatestImage range={imageRange} />
          <SufficiencyMap range={imageRange} engineContext={engineContext} />
          <ETOverlay etcDaily={etcDaily} range={imageRange} et={et} etLoading={etLoading} />
          <ReferenceETCheck etrDaily={etrDaily} range={imageRange} et={et} etLoading={etLoading} />
          <FieldSummary range={imageRange} index="NDRE" engineContext={engineContext} />
        </>
      ) : cleared ? (
        <div className="rounded-xl2 border border-status-hold/25 bg-status-hold/[0.06] p-6 text-center text-sm font-medium text-status-hold">
          Field cleared — draw or upload a new one to start over.
        </div>
      ) : (
        <div className="rounded-xl2 border border-dashed border-hairline bg-card p-6 text-center text-sm text-muted">
          No field selected — draw one on the map (draw tool, top-left) or upload a GeoJSON polygon.
        </div>
      )}

      {/* floating "Ask about this field" launcher — Field Health only */}
      <FieldChat range={imageRange} index="NDRE" engineContext={engineContext} />
    </>
  );
}
