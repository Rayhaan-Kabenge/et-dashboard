import { API_BASE } from "@/lib/api";
import type { Field, GeoPolygon, IndexSeries, FieldImage, ETResponse } from "./types";

const BASE = `${API_BASE}/api/field`;

async function asJson<T>(res: Response): Promise<T> {
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

export async function getActiveField(): Promise<Field | null> {
  return asJson<Field | null>(await fetch(BASE, { cache: "no-store" }));
}

export interface GeocodeResult {
  display_name: string;
  lat: number;
  lon: number;
  bbox?: [number, number, number, number] | null; // [south, north, west, east]
}

// View-only map navigation. Server-side Nominatim proxy; never touches the field.
export async function geocode(q: string): Promise<GeocodeResult[]> {
  const r = await asJson<{ results: GeocodeResult[] }>(
    await fetch(`${BASE}/geocode?q=${encodeURIComponent(q)}`, { cache: "no-store" })
  );
  return r.results ?? [];
}

export async function deleteField(fieldId: string): Promise<{ cleared: boolean }> {
  return asJson<{ cleared: boolean }>(await fetch(`${BASE}/${fieldId}`, { method: "DELETE" }));
}

export async function createField(name: string, geometry: GeoPolygon, crop?: string | null): Promise<Field> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, geometry, crop: crop ?? null }),
  });
  return asJson<Field>(res);
}

export async function getIndices(
  fieldId: string,
  index: string,
  start: string,
  end: string
): Promise<IndexSeries> {
  const q = new URLSearchParams({ index, start, end });
  return asJson<IndexSeries>(await fetch(`${BASE}/${fieldId}/indices?${q}`, { cache: "no-store" }));
}

export async function getImage(
  fieldId: string,
  index: string,
  range?: { start: string; end: string } | null
): Promise<FieldImage> {
  const q = new URLSearchParams({ index });
  if (range) {
    q.set("start", range.start);
    q.set("end", range.end);
  } else {
    q.set("date", "latest");
  }
  return asJson<FieldImage>(await fetch(`${BASE}/${fieldId}/image?${q}`, { cache: "no-store" }));
}

export async function getEt(fieldId: string, range: { start: string; end: string }): Promise<ETResponse> {
  const q = new URLSearchParams({ start: range.start, end: range.end });
  return asJson<ETResponse>(await fetch(`${BASE}/${fieldId}/et?${q}`, { cache: "no-store" }));
}

export async function postSummary(fieldId: string, body?: unknown, force = false): Promise<any> {
  return asJson(
    await fetch(`${BASE}/${fieldId}/summary${force ? "?force=1" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
  );
}
