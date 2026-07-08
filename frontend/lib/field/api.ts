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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  status: string; // "ok" | "unconfigured" | "error"
  reply?: string | null;
  model?: string | null;
  generated_at?: string | null;
  message?: string | null;
}

export interface ChatRequestBody {
  messages: ChatMessage[];
  range: { start: string; end: string } | Record<string, never>;
  index: string;
  engine_context: Record<string, unknown>;
}

export async function postChat(fieldId: string, body: ChatRequestBody): Promise<ChatResponse> {
  return asJson<ChatResponse>(
    await fetch(`${BASE}/${fieldId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export interface SufficiencyResponse {
  status: "ok" | "unavailable";
  field_id?: string | null;
  index: string;
  scene_date?: string | null;
  reference_ndre?: number | null;
  reference_method?: string | null;
  canopy_median_ndre?: number | null;
  valid_fraction?: number | null;
  bare_soil_cutoff?: number | null;
  cropped_fraction?: number | null;
  bare_fraction?: number | null;
  threshold?: number | null;
  pct_below_threshold?: number | null; // over cropped pixels only
  histogram?: number[] | null; // 0.01-wide SI bins over [0, 1.01)
  png_base64?: string | null;
  bbox?: number[] | null;
  caveat?: string | null;
  note?: string | null;
}

export async function getSufficiency(
  fieldId: string,
  range: { start: string; end: string },
  threshold: number
): Promise<SufficiencyResponse> {
  const q = new URLSearchParams({ start: range.start, end: range.end, threshold: String(threshold) });
  return asJson<SufficiencyResponse>(await fetch(`${BASE}/${fieldId}/sufficiency?${q}`, { cache: "no-store" }));
}

export interface SiSummaryResult {
  status: string; // "ok" | "unavailable" | "unconfigured" | "error"
  summary_text?: string | null;
  generated_at?: string | null;
  model?: string | null;
  message?: string | null;
}

// Spatial AI summary of the masked SI stats (same grounded architecture as the
// field summary; server-side cache keyed by inputs fingerprint).
export async function postSiSummary(
  fieldId: string,
  body: { range: { start: string; end: string }; threshold: number; engine_context: Record<string, unknown> },
  force = false
): Promise<SiSummaryResult> {
  return asJson<SiSummaryResult>(
    await fetch(`${BASE}/${fieldId}/sufficiency/summary${force ? "?force=1" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export function sufficiencyExportUrl(
  fieldId: string,
  range: { start: string; end: string },
  threshold: number,
  format: "geojson" | "shp"
): string {
  const q = new URLSearchParams({ start: range.start, end: range.end, threshold: String(threshold), format });
  return `${BASE}/${fieldId}/sufficiency/export?${q}`;
}
