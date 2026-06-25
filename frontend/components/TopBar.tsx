"use client";

import type { StateResponse } from "@/lib/types";
import FreshnessDot from "./FreshnessDot";
import WeatherChips from "./WeatherChips";
import UnitsToggle from "./UnitsToggle";
import LiveClock from "./LiveClock";

function LeafMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 text-leaf-600" aria-hidden>
      <path
        fill="currentColor"
        d="M20 3c-9 0-16 5-16 13 0 1.7.4 3.2 1 4.5C7 16 11 12 17 10c-5 3-8 7-9 12 1 .3 2 .5 3 .5 8 0 13-7 13-16 0-1.4-.1-2.7-.4-4-1.2.0-2.4 0-3.6 0Z"
      />
    </svg>
  );
}

export default function TopBar({
  state,
  onRefresh,
  refreshing,
}: {
  state: StateResponse;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { site } = state;
  return (
    <header className="sticky top-0 z-20 border-b border-black/5 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-3">
          <LeafMark />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold leading-tight text-ink">{site.name}</h1>
              {site.demo_mode && (
                <span className="chip bg-amber-400/15 text-amber-500 !px-2 !py-0.5 text-xs">demo</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-ink/50">
              <span>Season {site.season}</span>
              <span>·</span>
              <span>
                {site.latitude.toFixed(2)}°, {site.longitude !== null ? `${site.longitude.toFixed(2)}°` : "lon n/a"}
              </span>
              <span>·</span>
              <LiveClock />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <WeatherChips state={state} />
          <div className="h-5 w-px bg-black/10" />
          <FreshnessDot freshness={state.freshness} />
          <UnitsToggle />
          {site.sheet_edit_url && (
            <a
              href={site.sheet_edit_url}
              target="_blank"
              rel="noreferrer"
              className="chip border border-black/10 bg-white text-ink/70 hover:border-leaf-500 hover:text-leaf-700"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth={2}>
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M14 4h6v6M10 14 20 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Edit sheet
            </a>
          )}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="chip bg-leaf-600 text-white hover:bg-leaf-700 disabled:opacity-50"
            title="Re-read the sheet and re-anchor the forecast"
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-3.5 w-3.5 fill-none stroke-current ${refreshing ? "animate-spin" : ""}`}
              strokeWidth={2}
            >
              <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>
    </header>
  );
}
