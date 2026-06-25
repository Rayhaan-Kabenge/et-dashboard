import { API_BASE } from "@/lib/api";
import type { Field, GeoPolygon, IndexSeries, FieldImage } from "./types";

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

export function imageUrl(fieldId: string, index: string, date = "latest"): string {
  const q = new URLSearchParams({ index, date });
  return `${BASE}/${fieldId}/image?${q}`;
}

export async function getImage(fieldId: string, index: string, date = "latest"): Promise<FieldImage> {
  const q = new URLSearchParams({ index, date });
  return asJson<FieldImage>(await fetch(`${BASE}/${fieldId}/image?${q}`, { cache: "no-store" }));
}

export async function postSummary(fieldId: string): Promise<{ status: string; message: string }> {
  return asJson(await fetch(`${BASE}/${fieldId}/summary`, { method: "POST" }));
}
