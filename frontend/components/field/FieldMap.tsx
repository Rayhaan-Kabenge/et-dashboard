"use client";

import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import "@geoman-io/leaflet-geoman-free";
import type { Map as LeafletMap } from "leaflet";
import { Upload, Save, X, Pencil } from "lucide-react";
import { useField } from "@/lib/field/context";
import type { Field, GeoPolygon } from "@/lib/field/types";
import { Button } from "@/components/ui/button";
import MapSearch, { type FlyTo } from "./MapSearch";

const ESRI =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function extractPolygon(json: any): GeoPolygon {
  if (!json || typeof json !== "object") throw new Error("not valid JSON");
  if (json.type === "Polygon") return json;
  if (json.type === "Feature") {
    if (json.geometry?.type === "Polygon") return json.geometry;
    throw new Error("Feature is not a Polygon");
  }
  if (json.type === "FeatureCollection") {
    const polys = (json.features || []).filter((f: any) => f.geometry?.type === "Polygon");
    if (polys.length === 1) return polys[0].geometry;
    if (polys.length === 0) throw new Error("no Polygon found");
    throw new Error("multiple polygons — provide a single Polygon");
  }
  throw new Error("expected a GeoJSON Polygon / Feature / FeatureCollection");
}

// Geoman is only the drawing tool: capture geometry, remove its layer, then we
// render everything declaratively (no duplicate layers).
function DrawControls({ onDraw }: { onDraw: (g: GeoPolygon) => void }) {
  const map = useMap();
  useEffect(() => {
    map.pm.addControls({
      position: "topleft",
      drawPolygon: true,
      drawRectangle: true,
      editMode: false,
      dragMode: false,
      cutPolygon: false,
      rotateMode: false,
      removalMode: false,
      drawMarker: false,
      drawCircle: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawText: false,
    });
    map.pm.setGlobalOptions({ continueDrawing: false } as any);
    const onCreate = (e: any) => {
      const geom = e.layer.toGeoJSON().geometry as GeoPolygon;
      map.removeLayer(e.layer);
      onDraw(geom);
    };
    map.on("pm:create", onCreate);
    return () => {
      map.off("pm:create", onCreate);
      try {
        map.pm.removeControls();
      } catch {
        /* noop */
      }
    };
  }, [map, onDraw]);
  return null;
}

function FitTo({ field, pending }: { field: Field | null; pending: GeoPolygon | null }) {
  const map = useMap();
  useEffect(() => {
    const geom = pending ?? field?.geometry;
    if (!geom) return;
    const ll = geom.coordinates[0].map((p) => [p[1], p[0]]) as [number, number][];
    if (ll.length) map.fitBounds(ll, { padding: [24, 24], maxZoom: 16 });
  }, [field, pending, map]);
  return null;
}

// On first load with no active field, open near the working area — the sheet's
// site coordinate (same lat/lon the engine/forecast use), at a regional zoom.
// Runs once; never fights the user's panning, and yields to an active field.
function InitialCenter({
  siteCenter,
  hasField,
}: {
  siteCenter: [number, number] | null;
  hasField: boolean;
}) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || hasField || !siteCenter) return;
    map.setView(siteCenter, 10);
    done.current = true;
  }, [siteCenter, hasField, map]);
  return null;
}

export default function FieldMap({ siteCenter = null }: { siteCenter?: [number, number] | null }) {
  const { field, saveField, saving } = useField();
  const [pending, setPending] = useState<GeoPolygon | null>(null);
  const [name, setName] = useState("");
  const [crop, setCrop] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  const center: [number, number] = field ? [field.centroid[1], field.centroid[0]] : [39.5, -98.35];
  const zoom = field ? 14 : 4;

  // View-only navigation from the search box: pans/zooms the map, nothing else.
  const flyTo = useCallback<FlyTo>((lat, lon, bbox) => {
    const map = mapRef.current;
    if (!map) return;
    if (bbox) {
      const [s, n, w, e] = bbox; // [south, north, west, east]
      map.fitBounds([[s, w], [n, e]], { padding: [24, 24], maxZoom: 16 });
    } else {
      map.flyTo([lat, lon], 14);
    }
  }, []);

  const onUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setErr(null);
        setPending(extractPolygon(JSON.parse(String(reader.result))));
      } catch (e: any) {
        setErr(`Upload failed: ${e.message}`);
      }
    };
    reader.readAsText(file);
  }, []);

  async function onSave() {
    if (!pending) return;
    try {
      await saveField(name.trim() || "My field", pending, crop.trim() || null);
      setPending(null);
      setName("");
      setCrop("");
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl2 border border-hairline bg-card">
      <MapContainer ref={mapRef} center={center} zoom={zoom} scrollWheelZoom className="h-[440px] w-full" style={{ background: "#0c1a12" }}>
        <TileLayer url={ESRI} maxZoom={19} attribution='Imagery &copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics' />
        {field && (
          <GeoJSON key={`active-${field.id}`} data={field.geometry as any} style={{ color: "#FBFAF7", weight: 2.5, fillColor: "#2E7D49", fillOpacity: 0.12 }} />
        )}
        {pending && (
          <GeoJSON key={`pending-${JSON.stringify(pending.coordinates).length}`} data={pending as any} style={{ color: "#C9821F", weight: 2.5, dashArray: "5 4", fillColor: "#C9821F", fillOpacity: 0.12 }} />
        )}
        <DrawControls onDraw={setPending} />
        <FitTo field={field} pending={pending} />
        <InitialCenter siteCenter={siteCenter} hasField={!!field} />
      </MapContainer>

      {/* search + upload controls (top-right overlay) */}
      <div className="pointer-events-none absolute right-3 top-3 z-[500] flex flex-col items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
        />
        <div className="flex items-center gap-2">
          <MapSearch onFly={flyTo} />
          <Button size="sm" variant="outline" className="pointer-events-auto shadow-card" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Upload GeoJSON
          </Button>
        </div>
        {!field && !pending && (
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-lg bg-card/95 px-2.5 py-1.5 text-xs text-muted shadow-card">
            <Pencil className="h-3.5 w-3.5" /> use the draw tool (top-left) or upload
          </div>
        )}
      </div>

      {/* save bar (when a new geometry is pending) */}
      {pending && (
        <div className="absolute inset-x-3 bottom-3 z-[500] flex flex-wrap items-center gap-2 rounded-xl2 border border-hairline bg-card/95 p-2.5 shadow-hero backdrop-blur">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Field name"
            className="h-8 min-w-[140px] flex-1 rounded-md border border-hairline bg-card px-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          />
          <input
            value={crop}
            onChange={(e) => setCrop(e.target.value)}
            placeholder="Crop (optional)"
            className="h-8 w-32 rounded-md border border-hairline bg-card px-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          />
          <Button size="sm" onClick={onSave} disabled={saving}>
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving" : field ? "Replace field" : "Save field"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPending(null)} aria-label="Discard">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {err && (
        <div className="absolute inset-x-3 top-3 z-[500] rounded-lg border border-status-now/30 bg-status-now/[0.08] px-3 py-1.5 text-xs text-status-now">
          {err}
        </div>
      )}
    </div>
  );
}
