import type { StateResponse } from "./types";

// Backend base URL. Same-origin in prod via NEXT_PUBLIC_API_BASE; localhost in dev.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "http://localhost:8000";

export async function fetchState(refresh = false): Promise<StateResponse> {
  const url = `${API_BASE}/api/state${refresh ? "?refresh=1" : ""}`;
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
