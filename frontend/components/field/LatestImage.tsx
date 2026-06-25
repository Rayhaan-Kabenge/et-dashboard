"use client";

import { useEffect, useState } from "react";
import { Image as ImageIcon, CloudOff, Maximize2, X } from "lucide-react";
import { useField } from "@/lib/field/context";
import { getImage } from "@/lib/field/api";
import type { FieldImage } from "@/lib/field/types";
import CollapsibleCard from "./CollapsibleCard";
import { Skeleton } from "@/components/ui/skeleton";

export default function LatestImage() {
  const { field } = useField();
  const [index, setIndex] = useState<"NDRE" | "NDVI">("NDRE");
  const [img, setImg] = useState<FieldImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!field) return;
    let cancelled = false;
    setLoading(true);
    getImage(field.id, index, "latest")
      .then((d) => !cancelled && (setImg(d), setError(null)))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [field, index]);

  const src = img?.png_base64 ? `data:image/png;base64,${img.png_base64}` : null;
  const note = img?.note ?? error ?? null;

  return (
    <CollapsibleCard
      title="Latest image"
      subtitle={`Colorized ${index} · least-cloud scene`}
      icon={ImageIcon}
      right={
        <div className="inline-flex rounded-full border border-hairline p-0.5 text-xs">
          {(["NDRE", "NDVI"] as const).map((ix) => (
            <button
              key={ix}
              onClick={() => setIndex(ix)}
              className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
                index === ix ? "bg-brand text-canvas" : "text-muted hover:text-ink"
              }`}
            >
              {ix}
            </button>
          ))}
        </div>
      }
    >
      {loading ? (
        <Skeleton className="aspect-video w-full max-w-md rounded-lg" />
      ) : src ? (
        <div className="max-w-md">
          <button
            onClick={() => setZoom(true)}
            className="group relative block w-full overflow-hidden rounded-lg border border-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${index} map of the field`} className="w-full bg-[#0c1a12]" style={{ imageRendering: "pixelated" }} />
            <span className="absolute right-2 top-2 rounded-md bg-card/85 p-1 text-ink opacity-0 transition-opacity group-hover:opacity-100">
              <Maximize2 className="h-3.5 w-3.5" />
            </span>
          </button>
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted">
            <span>{index} · {img?.date ?? "latest"}</span>
            <Ramp />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-hairline bg-soil-soft/20 py-10 text-center">
          <CloudOff className="h-6 w-6 text-muted" />
          <p className="max-w-sm text-sm text-muted">{note ?? "No cloud-free image available."}</p>
        </div>
      )}

      {zoom && src && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/70 p-6" onClick={() => setZoom(false)} role="dialog" aria-modal>
          <button className="absolute right-4 top-4 rounded-full bg-card p-2 text-ink" onClick={() => setZoom(false)} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`${index} map enlarged`} className="max-h-full max-w-full rounded-lg border border-hairline bg-[#0c1a12]" style={{ imageRendering: "pixelated" }} />
        </div>
      )}
    </CollapsibleCard>
  );
}

function Ramp() {
  return (
    <span className="inline-flex items-center gap-1.5">
      low
      <span className="h-2 w-16 rounded-full" style={{ background: "linear-gradient(90deg, var(--status-now), var(--status-soon), var(--brand-accent))" }} />
      high
    </span>
  );
}
