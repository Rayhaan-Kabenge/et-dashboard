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

// Reloadable view of the farm fields (for the zone-drawing UI).
export function useFarmFields() {
  const [data, setData] = useState<FieldsResponse | null>(null);
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

  const field = data?.fields.find((f) => f.id === data.active_field_id) ?? data?.fields[0] ?? null;
  return { field, zones: field?.zones ?? [], loading, error, reload };
}

/**
 * Resolve the active zone from the URL crop + the fields list. The crop param
 * (corn|sorghum) maps 1:1 to a zone of the active field today; this keeps the
 * shareable ?crop= URL while making everything genuinely zone-driven (the risk
 * panel and the per-zone window key off `zone.id`).
 */
export function useActiveZone() {
  const { crop } = useCrop();
  const [data, setData] = useState<FieldsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    getFields()
      .then((d) => on && setData(d))
      .catch((e) => on && setError(e?.message ?? "Failed to load fields"))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, []);

  const field =
    data?.fields.find((f) => f.id === data.active_field_id) ?? data?.fields[0] ?? null;
  const zones = field?.zones ?? [];
  const zone =
    zones.find((z) => z.crop.toLowerCase() === crop.toLowerCase()) ?? zones[0] ?? null;

  return { zone, zones, field, crop, loading, error };
}
