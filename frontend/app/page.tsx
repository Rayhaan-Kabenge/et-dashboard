"use client";

import { useCallback, useEffect, useState } from "react";
import type { StateResponse } from "@/lib/types";
import { fetchState } from "@/lib/api";
import TopBar from "@/components/TopBar";
import AlertsBar from "@/components/AlertsBar";
import HeroBanner from "@/components/HeroBanner";
import RootZoneMeter from "@/components/RootZoneMeter";
import RecommendationPanel from "@/components/RecommendationPanel";
import WeatherBar from "@/components/WeatherBar";
import DepletionChart from "@/components/DepletionChart";
import GrowthStageCard from "@/components/GrowthStageCard";
import RecordsPanel from "@/components/RecordsPanel";
import SensorPane from "@/components/SensorPane";
import DashboardSkeleton from "@/components/DashboardSkeleton";
import { Button } from "@/components/ui/button";
import { AlertTriangle, FlaskConical, RefreshCw } from "lucide-react";
import { fmtDate } from "@/lib/format";
import CardChevron from "@/components/CardChevron";

export default function Page() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [depOpen, setDepOpen] = useState(true);

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

  if (loading && !state) return <DashboardSkeleton />;
  if (error && !state) return <ErrorScreen message={error} onRetry={() => load()} />;
  if (!state) return null;

  const forecastOnly = state.series.length > 0 && state.series.every((p) => p.is_forecast);

  return (
    <div className="min-h-screen">
      <TopBar state={state} onRefresh={() => load(true)} refreshing={refreshing} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-status-soon/30 bg-status-soon/[0.08] px-4 py-2 text-sm text-status-soon">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Showing last-known data — refresh failed: {error}
          </div>
        )}
        {state.site.demo_mode && (
          <div className="flex items-center gap-2 rounded-lg border border-hairline bg-soil-soft/40 px-4 py-2 text-sm text-soil-deep">
            <FlaskConical className="h-4 w-4 shrink-0" />
            <span><span className="font-medium">Demo data</span> — a sample season. Point <code className="rounded bg-ink/5 px-1 font-mono text-xs">SHEET_ID</code> at your published sheet to go live.</span>
          </div>
        )}
        {forecastOnly && (
          <div className="rounded-lg border border-water/25 bg-water/[0.06] px-4 py-2 text-sm text-water">
            Forecast only — no actual weather logged yet this season, so values shown are projections.
          </div>
        )}
        <AlertsBar alerts={state.alerts} />

        <HeroBanner state={state} />

        <RootZoneMeter state={state} />

        <RecommendationPanel state={state} />

        <WeatherBar state={state} />

        <div className="grid gap-6 lg:grid-cols-[1.9fr_1fr]">
          <div className="card flex flex-col p-6">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardChevron open={depOpen} onClick={() => setDepOpen((o) => !o)} label="depletion forecast" />
                <div>
                  <h3 className="text-lg font-semibold text-ink">Depletion forecast</h3>
                  <p className="text-sm text-ink/50">
                    Root-zone depletion vs allowable depletion · forecast through {fmtDate(state.freshness.forecast_through)}
                  </p>
                </div>
              </div>
              <Legend />
            </div>
            {depOpen && <DepletionChart state={state} />}
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

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl2 border border-hairline bg-card p-8 text-center shadow-card">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-status-now/[0.1] text-status-now">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-ink">Couldn’t reach the API</h2>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <p className="mt-2 font-mono text-xs text-muted/70">
          Is the backend running at <code className="rounded bg-ink/5 px-1">{process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000"}</code>?
        </p>
        <Button onClick={onRetry} className="mt-5">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    </div>
  );
}
