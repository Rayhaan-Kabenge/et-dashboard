"use client";

import { useEffect, useState } from "react";
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
