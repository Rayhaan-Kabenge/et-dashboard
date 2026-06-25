"use client";

import { MapPin, ExternalLink, RefreshCw } from "lucide-react";
import type { StateResponse } from "@/lib/types";
import FreshnessDot from "./FreshnessDot";
import UnitsToggle from "./UnitsToggle";
import LiveClock from "./LiveClock";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

// water-drop-as-leaf wordmark
function Wordmark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl2 bg-brand/10">
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path
          d="M12 2.5c3.6 4.2 6.5 7.6 6.5 11.2A6.5 6.5 0 0 1 12 20.2a6.5 6.5 0 0 1-6.5-6.5C5.5 10.1 8.4 6.7 12 2.5Z"
          fill="var(--water)"
          opacity="0.18"
        />
        <path
          d="M12 2.5c3.6 4.2 6.5 7.6 6.5 11.2A6.5 6.5 0 0 1 12 20.2"
          fill="none"
          stroke="var(--brand)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path d="M12 7.5v9M12 11.5c1.6-.4 2.8-1.4 3.3-3M12 14c-1.5-.3-2.6-1.2-3.1-2.6"
          fill="none" stroke="var(--brand-accent)" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
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
    <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        {/* identity */}
        <div className="flex items-center gap-3">
          <Wordmark />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-semibold leading-tight tracking-tight text-ink">{site.name}</h1>
              {site.demo_mode && (
                <Badge variant="soon" className="px-2 py-0">demo</Badge>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted">
              <span>Season {site.season}</span>
              <span className="text-hairline">·</span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {site.latitude.toFixed(2)}°{site.longitude !== null ? `, ${site.longitude.toFixed(2)}°` : ""}
              </span>
              <span className="text-hairline">·</span>
              <LiveClock />
            </div>
          </div>
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <FreshnessDot freshness={state.freshness} />
          <Separator orientation="vertical" className="h-5" />
          <UnitsToggle />
          {site.sheet_edit_url && (
            <Button variant="outline" size="sm" asChild>
              <a href={site.sheet_edit_url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Edit sheet
              </a>
            </Button>
          )}
          <Button size="sm" onClick={onRefresh} disabled={refreshing} title="Re-read the sheet and re-anchor the forecast">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        </div>
      </div>
    </header>
  );
}
