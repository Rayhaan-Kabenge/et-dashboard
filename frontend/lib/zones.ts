"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { useCrop } from "@/lib/crop";

// Engine-side Field→Zone model (mirror backend/app/farm/schemas.py). Each zone
// carries its own crop + sheet; its sheet drives that zone's engine run. The
// requirement window and risk display are per-zone off this.

export interface Zone {
  id: string;
  name: string;
  crop: string;
  sheet_id: string;
  season_year?: number | null;
  boundary?: unknown | null;
  area_acres?: number | null;
}

export interface Field {
  id: string;
  name: string;
  boundary?: unknown | null;
  area_acres?: number | null;
  meter?: unknown | null;
  zones: Zone[];
}

export interface FieldsResponse {
  active_field_id: string | null;
  fields: Field[];
}

export async function getFields(): Promise<FieldsResponse> {
  const res = await fetch(`${API_BASE}/api/fields`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// GeoJSON polygon (matches the field-health drawing output).
export interface GeoPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

async function asFieldJson(res: Response): Promise<Field> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.detail) detail = typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

// --- Slice 4a: drawn boundaries wire onto the engine zones -------------------
export async function setFieldBoundary(fieldId: string, geometry: GeoPolygon): Promise<Field> {
  return asFieldJson(
    await fetch(`${API_BASE}/api/fields/${fieldId}/boundary`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geometry }),
    })
  );
}

export async function addZone(
  fieldId: string,
  body: { name: string; crop: string; boundary?: GeoPolygon | null }
): Promise<Field> {
  return asFieldJson(
    await fetch(`${API_BASE}/api/fields/${fieldId}/zones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export async function updateZone(
  fieldId: string,
  zoneId: string,
  patch: { name?: string; crop?: string; boundary?: GeoPolygon | null }
): Promise<Field> {
  return asFieldJson(
    await fetch(`${API_BASE}/api/fields/${fieldId}/zones/${zoneId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  );
}

export async function deleteZone(fieldId: string, zoneId: string): Promise<Field> {
  return asFieldJson(
    await fetch(`${API_BASE}/api/fields/${fieldId}/zones/${zoneId}`, { method: "DELETE" })
  );
}

// The active zone lives in the URL as ?zone=<zone_id> (shareable + carried across
// tabs by TabNav). ?crop= is kept as a legacy alias.
export function readZoneParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("zone");
}

/**
 * The active zone — the drill-in target that drives the per-zone requirement
 * window and the zone-info panel. Resolution order:
 *   1. ?zone=<zone_id>  (map click / zone selector — precise, disambiguates
 *      same-crop zones)
 *   2. ?crop=<crop>     (legacy alias — first zone of that crop)
 *   3. the field's first zone (sensible default — never a blank state)
 *
 * `setActiveZone(zoneId)` writes ?zone= AND syncs ?crop= to that zone's crop, so
 * the existing crop-based consumers (growth stage, field-health engine context)
 * follow. Both map clicks and the dropdown call it, so they stay in sync.
 */
export function useActiveZone() {
  const { crop } = useCrop();
  const [data, setData] = useState<FieldsResponse | null>(null);
  const [zoneParam, setZoneParam] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await getFields());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load fields");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const sync = () => setZoneParam(readZoneParam());
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("zonechange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("zonechange", sync);
    };
  }, []);

  const field =
    data?.fields.find((f) => f.id === data.active_field_id) ?? data?.fields[0] ?? null;
  const zones = field?.zones ?? [];
  const zone =
    zones.find((z) => z.id === zoneParam) ?? // 1. precise zone id
    zones.find((z) => z.crop.toLowerCase() === crop.toLowerCase()) ?? // 2. crop alias
    zones[0] ?? // 3. default: first zone
    null;

  const setActiveZone = useCallback(
    (zoneId: string) => {
      const z = (data?.fields.flatMap((f) => f.zones) ?? []).find((x) => x.id === zoneId);
      const url = new URL(window.location.href);
      url.searchParams.set("zone", zoneId);
      if (z) url.searchParams.set("crop", z.crop); // keep the legacy alias in sync
      window.history.replaceState(window.history.state, "", url.toString());
      window.dispatchEvent(new Event("zonechange"));
      if (z) window.dispatchEvent(new Event("cropchange")); // wake crop-based consumers
    },
    [data]
  );

  // Self-heal a stale ?zone= that points at a zone that no longer exists (e.g. a
  // shared/bookmarked link to a since-deleted zone). The view already falls back
  // via the resolution order above; this rewrites the URL to the resolved zone so
  // it never lingers on a deleted zone_id.
  useEffect(() => {
    if (zoneParam && zones.length > 0 && !zones.some((z) => z.id === zoneParam) && zone) {
      setActiveZone(zone.id);
    }
  }, [zoneParam, zones, zone, setActiveZone]);

  return { zone, zones, field, crop, loading, error, setActiveZone, reload };
}
