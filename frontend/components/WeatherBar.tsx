"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, Tooltip as RTooltip, ReferenceArea, ResponsiveContainer,
} from "recharts";
import { Sun, CloudSun, Cloud, CloudDrizzle, CloudRain, Droplets, Wind, Thermometer, Gauge } from "lucide-react";
import type { StateResponse, SeriesPoint } from "@/lib/types";
import { useUnits, fmtDepth, toDisplay } from "@/lib/units";
import { fmtDate } from "@/lib/format";

type Cond = { key: string; Icon: typeof Sun; label: string };
function condition(precip: number | null, rs?: number | null): Cond {
  if (precip != null && precip >= 5) return { key: "rain", Icon: CloudRain, label: "Rain" };
  if (precip != null && precip > 0) return { key: "showers", Icon: CloudDrizzle, label: "Showers" };
  if (rs != null && rs < 12) return { key: "cloudy", Icon: Cloud, label: "Cloudy" };
  if (rs != null && rs < 18) return { key: "partly", Icon: CloudSun, label: "Partly cloudy" };
  return { key: "clear", Icon: Sun, label: "Clear" };
}

export default function WeatherBar({ state }: { state: StateResponse }) {
  const { unit } = useUnits();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const series = state.series;
  const today = state.today;
  const forecast = series.filter((p) => p.is_forecast);
  const actualsTail = series.filter((p) => !p.is_forecast).slice(-6);
  const window = [...actualsTail, ...forecast.slice(0, 9)];
  const firstForecast = forecast[0]?.date;
  const lastWindow = window[window.length - 1]?.date;

  const data = window.map((p) => ({
    label: fmtDate(p.date),
    date: p.date,
    tmax: p.tmax,
    tmin: p.tmin,
    precip: toDisplay(p.precip, unit),
    isF: p.is_forecast,
  }));

  // irrigation-aware note: meaningful rain in the forecast
  const rainDay = forecast.find((p) => (p.precip ?? 0) >= 5);

  const tw = today?.weather;
  const todayCond = condition(tw?.precip ?? null, tw?.rs ?? null);

  return (
    <section className="rounded-xl2 border border-hairline bg-card shadow-card">
      <div className="flex flex-col gap-3 p-5 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-water/[0.1] text-water">
            <todayCond.Icon className="h-6 w-6" />
          </span>
          <div>
            <div className="stat-label">Weather · last actual</div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
                {tw?.tmax != null ? `${Math.round(tw.tmax)}°` : "—"}
              </span>
              <span className="font-mono text-base text-muted">{tw?.tmin != null ? `${Math.round(tw.tmin)}°` : "—"}</span>
              <span className="text-sm text-muted">{todayCond.label}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs text-muted">
          <Metric icon={Droplets} label="precip" value={fmtDepth(tw?.precip ?? 0, unit)} />
          <Metric icon={Gauge} label="RH" value={tw?.rhmin != null && tw?.rhmax != null ? `${Math.round(tw.rhmin)}–${Math.round(tw.rhmax)}%` : "—"} />
          <Metric icon={Wind} label="wind" value={tw?.u2 != null ? `${tw.u2.toFixed(1)} m/s` : "—"} />
          <Metric icon={Thermometer} label="Rs" value={tw?.rs != null ? `${tw.rs.toFixed(0)} MJ` : "—"} />
        </div>
      </div>

      {/* temp curve + precip bars */}
      <div className="px-3 pt-2">
        {mounted ? (
          <ResponsiveContainer width="100%" height={150}>
            <ComposedChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="tempFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2E7D49" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#2E7D49" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              {firstForecast && lastWindow && (
                <ReferenceArea x1={fmtDate(firstForecast)} x2={fmtDate(lastWindow)} fill="#1E6FA8" fillOpacity={0.05} ifOverflow="extendDomain" />
              )}
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6B7069", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={{ stroke: "#E7E5DF" }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis yAxisId="t" hide domain={["dataMin - 3", "dataMax + 3"]} />
              <YAxis yAxisId="p" hide domain={[0, (m: number) => Math.max(10, m * 3)]} />
              <RTooltip content={<WxTip unit={unit} />} />
              <Bar yAxisId="p" dataKey="precip" fill="#1E6FA8" fillOpacity={0.5} radius={[2, 2, 0, 0]} barSize={10} />
              <Area yAxisId="t" type="monotone" dataKey="tmax" stroke="#2E7D49" strokeWidth={2} fill="url(#tempFill)" dot={false} />
              <Line yAxisId="t" type="monotone" dataKey="tmin" stroke="#9A6440" strokeWidth={1.6} strokeDasharray="3 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[150px] w-full animate-pulse rounded-md bg-ink/[0.05]" />
        )}
      </div>

      {/* 7-day forecast row */}
      <div className="flex gap-2 overflow-x-auto px-5 pb-4 pt-2">
        {forecast.slice(0, 7).map((p) => {
          const c = condition(p.precip ?? null);
          return (
            <div key={p.date} className="flex min-w-[68px] flex-1 flex-col items-center gap-1 rounded-lg border border-dashed border-water/30 bg-water/[0.03] px-2 py-2.5">
              <span className="font-mono text-[11px] font-medium text-muted">{fmtDate(p.date, { weekday: "short" })}</span>
              <c.Icon className="h-5 w-5 text-water" />
              <span className="font-mono text-xs font-semibold tabular-nums text-ink">
                {p.tmax != null ? `${Math.round(p.tmax)}°` : "—"}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted">{p.tmin != null ? `${Math.round(p.tmin)}°` : "—"}</span>
              {(p.precip ?? 0) > 0 && (
                <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-water">
                  <Droplets className="h-2.5 w-2.5" />
                  {fmtDepth(p.precip, unit)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {rainDay && (
        <div className="mx-5 mb-4 flex items-center gap-2 rounded-lg bg-water/[0.07] px-3 py-2 text-sm text-water">
          <CloudRain className="h-4 w-4" />
          <span>
            ≈{fmtDepth(rainDay.precip, unit)} rain {fmtDate(rainDay.date, { weekday: "long" })} — irrigation may be deferred.
          </span>
        </div>
      )}
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Sun; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" />
      <span className="text-muted/70">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </span>
  );
}

function WxTip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-lg border border-hairline bg-card px-3 py-2 font-mono text-xs shadow-hero">
      <div className="mb-1 font-semibold text-ink">
        {label} {row?.isF && <span className="text-water">· forecast</span>}
      </div>
      <div className="flex justify-between gap-6"><span className="text-muted">high</span><span className="text-ink">{row?.tmax != null ? `${Math.round(row.tmax)}°C` : "—"}</span></div>
      <div className="flex justify-between gap-6"><span className="text-muted">low</span><span className="text-ink">{row?.tmin != null ? `${Math.round(row.tmin)}°C` : "—"}</span></div>
      {row?.precip > 0 && <div className="flex justify-between gap-6"><span className="text-muted">precip</span><span className="text-water">{row.precip.toFixed(unit === "in" ? 2 : 1)} {unit}</span></div>}
    </div>
  );
}
