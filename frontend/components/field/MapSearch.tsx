"use client";

import { useState } from "react";
import { Search, X, Loader2, MapPin } from "lucide-react";
import { geocode, type GeocodeResult } from "@/lib/field/api";

// View-only: this only flies the map view. It never sets/creates/modifies the
// active field or any engine coordinate — drawing/uploading still does that.
export type FlyTo = (
  lat: number,
  lon: number,
  bbox?: [number, number, number, number] | null
) => void;

// "41.09, -100.77" fast path — two signed decimals, comma-separated.
const LATLON = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

type State = "idle" | "searching" | "empty" | "error";

export default function MapSearch({ onFly }: { onFly: FlyTo }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [state, setState] = useState<State>("idle");
  const [open, setOpen] = useState(false);

  async function submit() {
    const text = q.trim();
    if (!text) return;

    // lat,lon fast path — skip the geocoder entirely.
    const m = text.match(LATLON);
    if (m) {
      const lat = parseFloat(m[1]);
      const lon = parseFloat(m[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        onFly(lat, lon, null);
        setOpen(false);
        setState("idle");
        return;
      }
    }

    setState("searching");
    setOpen(true);
    setResults([]);
    try {
      const r = await geocode(text);
      setResults(r);
      setState(r.length ? "idle" : "empty");
    } catch {
      setState("error");
    }
  }

  function pick(r: GeocodeResult) {
    onFly(r.lat, r.lon, r.bbox ?? null);
    setQ(r.display_name.split(",").slice(0, 2).join(",").trim());
    setOpen(false);
  }

  function clear() {
    setQ("");
    setResults([]);
    setState("idle");
    setOpen(false);
  }

  return (
    <div className="relative pointer-events-auto">
      <div className="flex h-8 items-center gap-1.5 rounded-md border border-hairline bg-card/95 pl-2.5 pr-1.5 shadow-card focus-within:ring-2 focus-within:ring-brand/40">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              clear();
            }
          }}
          onFocus={() => {
            if (results.length || state !== "idle") setOpen(true);
          }}
          placeholder="Search place or lat, lon"
          aria-label="Search the map for a place or coordinates"
          className="w-44 bg-transparent text-sm text-ink placeholder:text-muted focus-visible:outline-none"
        />
        {q && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="shrink-0 rounded p-0.5 text-muted hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute right-0 top-9 z-[600] w-72 overflow-hidden rounded-lg border border-hairline bg-card shadow-hero">
          {state === "searching" ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          ) : state === "error" ? (
            <div className="px-3 py-2.5 text-sm text-status-now">
              Search unavailable — check your connection and try again.
            </div>
          ) : state === "empty" ? (
            <div className="px-3 py-2.5 text-sm text-muted">
              No matches — try a town, address, or lat, lon.
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.lat},${r.lon},${i}`}
                type="button"
                onClick={() => pick(r)}
                className="flex w-full items-start gap-2 border-t border-hairline/60 px-3 py-2 text-left text-sm text-ink first:border-t-0 hover:bg-soil-soft/40"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                <span className="line-clamp-2">{r.display_name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
