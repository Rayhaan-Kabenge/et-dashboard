import type { StateResponse } from "./types";

// Backend base URL. Same-origin in prod via NEXT_PUBLIC_API_BASE; localhost in dev.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "http://localhost:8000";

export async function fetchState(refresh = false, crop?: string, zoneId?: string): Promise<StateResponse> {
  const q = new URLSearchParams();
  if (refresh) q.set("refresh", "1");
  // zone_id is the primary selector (its sheet drives the run); crop stays as a
  // backwards-compatible alias. The backend resolves zone_id first.
  if (zoneId) q.set("zone_id", zoneId);
  if (crop) q.set("crop", crop);
  const qs = q.toString();
  const url = `${API_BASE}/api/state${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export interface CropOption {
  id: string;
  label: string;
}

// Registered crops for the toggle (server-side allow-list). Falls back to corn.
export async function fetchCrops(): Promise<CropOption[]> {
  try {
    const res = await fetch(`${API_BASE}/api/crops`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const list = await res.json();
    return Array.isArray(list) && list.length ? list : [{ id: "corn", label: "Corn" }];
  } catch {
    return [{ id: "corn", label: "Corn" }];
  }
}
