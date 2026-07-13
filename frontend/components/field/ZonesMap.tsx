"use client";

import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import "@geoman-io/leaflet-geoman-free";
import type { Map as LeafletMap } from "leaflet";
import { Upload, Save, X, Layers, Trash2, MapPin, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchCrops, type CropOption } from "@/lib/api";
import {
  useFarmFields, setFieldBoundary, addZone, deleteZone, type GeoPolygon, type Zone,
} from "@/lib/zones";
import MapSearch, { type FlyTo } from "./MapSearch";

const ESRI =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Zone fill colors by crop (hex — leaflet paints SVG attributes directly).
const CROP_HEX: Record<string, string> = { corn: "#2E7D49", sorghum: "#C9821F" };
const FALLBACK_HEX = ["#1e6fa8", "#7c3aed", "#0891b2", "#be185d"];
const zoneColor = (crop: string, i: number) => CROP_HEX[crop.toLowerCase()] ?? FALLBACK_HEX[i % FALLBACK_HEX.length];

function extractPolygon(json: any): GeoPolygon {
  if (!json || typeof json !== "object") throw new Error("not valid JSON");
  if (json.type === "Polygon") return json;
  if (json.type === "Feature" && json.geometry?.type === "Polygon") return json.geometry;
  if (json.type === "FeatureCollection") {
    const polys = (json.features || []).filter((f: any) => f.geometry?.type === "Polygon");
    if (polys.length === 1) return polys[0].geometry;
    throw new Error(polys.length ? "provide a single Polygon" : "no Polygon found");
  }
  throw new Error("expected a GeoJSON Polygon / Feature / FeatureCollection");
}

// Geoman is only the capture tool: grab geometry, drop its layer, we render declaratively.
function DrawControls({ onDraw }: { onDraw: (g: GeoPolygon) => void }) {
  const map = useMap();
  useEffect(() => {
    map.pm.addControls({
      position: "topleft", drawPolygon: true, drawRectangle: true,
      editMode: false, dragMode: false, cutPolygon: false, rotateMode: false, removalMode: false,
      drawMarker: false, drawCircle: false, drawCircleMarker: false, drawPolyline: false, drawText: false,
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
      try { map.pm.removeControls(); } catch { /* noop */ }
    };
  }, [map, onDraw]);
  return null;
}

function FitTo({ geom }: { geom: GeoPolygon | null }) {
  const map = useMap();
  useEffect(() => {
    if (!geom) return;
    const ll = geom.coordinates[0].map((p) => [p[1], p[0]]) as [number, number][];
    if (ll.length) map.fitBounds(ll, { padding: [24, 24], maxZoom: 15 });
  }, [geom, map]);
  return null;
}

/**
 * Slice 4a — the UNIFIED field/zone drawing surface. Zones drawn here ARE the
 * engine zones (they carry a crop + sheet_id and drive the irrigation windows);
 * this reuses the field-health map stack (leaflet + geoman + Esri + geocode).
 *
 * Step 1: draw/upload the whole-FIELD boundary.  Step 2: draw each management
 * ZONE and give it a name + crop. A zone is a named unit — two zones may share a
 * crop. Areas come from the polygons.
 *
 * Deferred (later slice): zone-level satellite. NDRE/SI stays field-level on the
 * field-health polygon for now; this map is the engine field/zones only.
 */
export default function ZonesMap() {
  const { field, zones, loading, reload } = useFarmFields();
  const [pending, setPending] = useState<GeoPolygon | null>(null);
  const [mode, setMode] = useState<"field" | "zone">("zone");
  const [zoneName, setZoneName] = useState("");
  const [zoneCrop, setZoneCrop] = useState("");
  const [crops, setCrops] = useState<CropOption[]>([{ id: "corn", label: "Corn" }]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    fetchCrops().then((c) => {
      setCrops(c);
      setZoneCrop((cur) => cur || c[0]?.id || "corn");
    }).catch(() => {});
  }, []);

  const fieldBoundary = (field?.boundary as GeoPolygon | undefined) ?? null;
  const center = useMemo<[number, number]>(() => {
    const ring = fieldBoundary?.coordinates?.[0];
    if (ring?.length) {
      const [lon, lat] = ring[0];
      return [lat, lon];
    }
    return [39.384, -101.065]; // Colby, KS
  }, [fieldBoundary]);

  const flyTo = useCallback<FlyTo>((lat, lon, bbox) => {
    const map = mapRef.current;
    if (!map) return;
    if (bbox) {
      const [s, n, w, e] = bbox;
      map.fitBounds([[s, w], [n, e]], { padding: [24, 24], maxZoom: 16 });
    } else map.flyTo([lat, lon], 14);
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

  async function saveFieldBoundary() {
    if (!pending || !field) return;
    setSaving(true);
    try {
      await setFieldBoundary(field.id, pending);
      await reload();
      setPending(null);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveZone() {
    if (!pending || !field) return;
    setSaving(true);
    try {
      await addZone(field.id, { name: zoneName.trim() || `${zoneCrop} zone`, crop: zoneCrop, boundary: pending });
      await reload();
      setPending(null);
      setZoneName("");
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeZone(z: Zone) {
    setErr(null);
    try {
      await deleteZone(field!.id, z.id);
      await reload();
    } catch (e: any) {
      setErr(e.message.includes("at least one") ? "A field must keep at least one zone." : e.message);
    }
  }

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Layers className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-lg font-semibold text-ink">Management zones</h3>
            <p className="text-sm text-ink/50">
              {field ? field.name : "—"} · the engine field &amp; zones that drive the irrigation windows. Draw the field, then each zone.
            </p>
          </div>
        </div>
        {/* draw-mode toggle */}
        <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline bg-card p-0.5 text-xs">
          {(["field", "zone"] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setPending(null); }}
              aria-pressed={mode === m}
              className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${mode === m ? "bg-brand text-canvas" : "text-muted hover:text-ink"}`}>
              draw {m}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <MapContainer ref={mapRef} center={center} zoom={fieldBoundary ? 14 : 12} scrollWheelZoom
          className="h-[420px] w-full" style={{ background: "#0c1a12" }}>
          <TileLayer url={ESRI} maxZoom={19}
            attribution='Imagery &copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics' />
          {fieldBoundary && (
            <GeoJSON key={`field-${JSON.stringify(fieldBoundary.coordinates).length}`} data={fieldBoundary as any}
              style={{ color: "#FBFAF7", weight: 2.5, fill: false }} />
          )}
          {zones.map((z, i) =>
            z.boundary ? (
              <GeoJSON key={`zone-${z.id}-${z.area_acres}`} data={z.boundary as any}
                style={{ color: zoneColor(z.crop, i), weight: 2, fillColor: zoneColor(z.crop, i), fillOpacity: 0.22 }} />
            ) : null
          )}
          {pending && (
            <GeoJSON key={`pending-${JSON.stringify(pending.coordinates).length}`} data={pending as any}
              style={{ color: "#C9821F", weight: 2.5, dashArray: "5 4", fillColor: "#C9821F", fillOpacity: 0.14 }} />
          )}
          <DrawControls onDraw={setPending} />
          <FitTo geom={fieldBoundary} />
        </MapContainer>

        {/* search + upload (top-right) */}
        <div className="pointer-events-none absolute right-3 top-3 z-[500] flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".geojson,.json,application/geo+json,application/json"
            className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          <MapSearch onFly={flyTo} />
          <Button size="sm" variant="outline" className="pointer-events-auto shadow-card" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Upload
          </Button>
        </div>

        {/* save bar (when a polygon is pending) */}
        {pending && (
          <div className="absolute inset-x-3 bottom-3 z-[500] flex flex-wrap items-center gap-2 rounded-xl2 border border-hairline bg-card/95 p-2.5 shadow-hero backdrop-blur">
            {mode === "field" ? (
              <>
                <span className="flex items-center gap-1.5 px-1 text-sm text-ink"><MapPin className="h-3.5 w-3.5 text-muted" /> Field outline</span>
                <Button size="sm" onClick={saveFieldBoundary} disabled={saving} className="ml-auto">
                  <Save className="h-3.5 w-3.5" /> {saving ? "Saving" : fieldBoundary ? "Replace boundary" : "Set field boundary"}
                </Button>
              </>
            ) : (
              <>
                <input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="Zone name (e.g. North half)"
                  className="h-8 min-w-[150px] flex-1 rounded-md border border-hairline bg-card px-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40" />
                {/* MVP: the crop picks the data source — corn→corn sheet, sorghum→sorghum sheet.
                    Two same-crop zones therefore share a sheet + window (documented decision;
                    per-zone independent sources is a deferred enhancement — see farm/api._sheet_for_crop). */}
                <select value={zoneCrop} onChange={(e) => setZoneCrop(e.target.value)}
                  className="h-8 rounded-md border border-hairline bg-card px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                  {crops.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <Button size="sm" onClick={saveZone} disabled={saving}>
                  <Sprout className="h-3.5 w-3.5" /> {saving ? "Saving" : "Add zone"}
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPending(null)} aria-label="Discard"><X className="h-3.5 w-3.5" /></Button>
          </div>
        )}

        {err && (
          <div className="absolute inset-x-3 top-3 z-[500] rounded-lg border border-status-now/30 bg-status-now/[0.08] px-3 py-1.5 text-xs text-status-now">
            {err}
          </div>
        )}
      </div>

      {/* zone list */}
      <div className="p-5 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="stat-label">Zones {field?.area_acres ? `· field ${field.area_acres.toFixed(0)} ac` : ""}</span>
          <span className="font-mono text-[11px] text-muted">draw a polygon (top-left tool), name it, pick a crop</span>
        </div>
        {loading ? (
          <div className="h-16 w-full animate-pulse rounded-md bg-ink/[0.05]" />
        ) : zones.length === 0 ? (
          <p className="text-sm text-ink/50">No zones yet.</p>
        ) : (
          <ul className="divide-y divide-hairline/70">
            {zones.map((z, i) => (
              <li key={z.id} className="flex items-center gap-3 py-2">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: zoneColor(z.crop, i) }} />
                <span className="font-medium text-ink">{z.name}</span>
                <span className="rounded-full bg-soil-soft/50 px-2 py-0.5 font-mono text-[11px] text-soil-deep">{z.crop}</span>
                <span className="font-mono text-[11px] text-muted">
                  {z.boundary ? `${z.area_acres?.toFixed(1) ?? "—"} ac` : "no geometry — still runs its window"}
                </span>
                <button type="button" onClick={() => removeZone(z)} aria-label={`Remove ${z.name}`}
                  className="ml-auto rounded-md p-1 text-muted transition-colors hover:bg-status-now/10 hover:text-status-now">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-ink/40">
          Zones drawn here are the engine zones — each carries a crop + its own sheet and produces a per-zone window.
          Two zones may share a crop with different names. Satellite (NDRE/SI) stays field-level for now.
        </p>
      </div>
    </section>
  );
}
