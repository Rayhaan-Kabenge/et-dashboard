"use client";

import { useCallback, useEffect, useState } from "react";
import type { StateResponse } from "@/lib/types";
import { fetchState } from "@/lib/api";
import TopBar from "@/components/TopBar";
import AlertsBar from "@/components/AlertsBar";
import HeroBanner from "@/components/HeroBanner";
import RootZoneMeter from "@/components/RootZoneMeter";
import WeatherBar from "@/components/WeatherBar";
import DepletionChart from "@/components/DepletionChart";
import GrowthStageCard from "@/components/GrowthStageCard";
import RecordsPanel from "@/components/RecordsPanel";
import SensorPane from "@/components/SensorPane";
import { fmtDate } from "@/lib/format";

export default function Page() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    try {
      refresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      const data = await fetchState(refresh);
      setState(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !state) return <Splash />;
  if (error && !state) return <ErrorScreen message={error} onRetry={() => load()} />;
  if (!state) return null;

  return (
    <div className="min-h-screen">
      <TopBar state={state} onRefresh={() => load(true)} refreshing={refreshing} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
        {error && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm text-amber-500">
            Showing last-known data — refresh failed: {error}
          </div>
        )}
        <AlertsBar alerts={state.alerts} />

        <HeroBanner state={state} />

        <RootZoneMeter state={state} />

        <WeatherBar state={state} />

        <div className="grid gap-6 lg:grid-cols-[1.9fr_1fr]">
          <div className="card flex flex-col p-6">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-ink">Depletion forecast</h3>
                <p className="text-sm text-ink/50">
                  Root-zone depletion vs allowable depletion · forecast through {fmtDate(state.freshness.forecast_through)}
                </p>
              </div>
              <Legend />
            </div>
            <DepletionChart state={state} />
          </div>
          <GrowthStageCard state={state} />
        </div>

        <RecordsPanel state={state} />
        <SensorPane />

        <Footer state={state} />
      </main>
    </div>
  );
}

function Legend() {
  return (
    <div className="hidden items-center gap-3 font-mono text-xs text-muted sm:flex">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-4 rounded-full bg-brand" /> actual
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0 w-4 border-t-2 border-dashed border-water" /> forecast
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0 w-4 border-t-2 border-dashed border-status-soon" /> AD
      </span>
    </div>
  );
}

function Footer({ state }: { state: StateResponse }) {
  return (
    <footer className="flex flex-col items-center gap-1 py-4 text-center text-xs text-ink/40">
      <div>
        Decisions computed by the validated <span className="font-medium text-ink/55">et_engine</span> (ASCE-2005 ETr via pyfao56).
        Actuals are authoritative; the forecast re-anchors on every refresh.
      </div>
      <div>
        Updated {new Date(state.generated_at).toLocaleString()} · forecast source: {state.freshness.forecast_source}
      </div>
    </footer>
  );
}

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-ink/50">
        <svg viewBox="0 0 24 24" className="h-8 w-8 animate-spin text-leaf-500 fill-none stroke-current" strokeWidth={2}>
          <path d="M21 12a9 9 0 1 1-2.6-6.4" strokeLinecap="round" />
        </svg>
        <span className="text-sm">Loading field state…</span>
      </div>
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-md p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-clay-500/10 text-clay-500">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth={2}>
            <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-ink">Couldn’t reach the API</h2>
        <p className="mt-2 text-sm text-ink/60">{message}</p>
        <p className="mt-2 text-xs text-ink/40">
          Is the backend running at <code className="rounded bg-black/5 px-1">{process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000"}</code>?
        </p>
        <button onClick={onRetry} className="mt-5 chip bg-leaf-600 text-white hover:bg-leaf-700">
          Retry
        </button>
      </div>
    </div>
  );
}
