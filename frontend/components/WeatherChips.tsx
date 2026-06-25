"use client";

import type { StateResponse } from "@/lib/types";
import { fmtDate } from "@/lib/format";

function dropletPath() {
  return "M12 3c3 4 6 7 6 11a6 6 0 1 1-12 0c0-4 3-7 6-11Z";
}

export default function WeatherChips({ state }: { state: StateResponse }) {
  const today = state.today;
  const forecast = state.series.filter((p) => p.is_forecast).slice(0, 3);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {today && (
        <div className="chip bg-leaf-50 text-leaf-700" title="Most recent actual day">
          <span className="font-semibold">Now</span>
          <span className="text-ink/70">
            {today.weather.tmax !== null ? `${Math.round(today.weather.tmax)}°` : "—"}
            {" / "}
            {today.weather.tmin !== null ? `${Math.round(today.weather.tmin)}°` : "—"}
          </span>
          {today.weather.precip ? (
            <span className="inline-flex items-center gap-0.5 text-sky-500">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d={dropletPath()} />
              </svg>
              {today.weather.precip.toFixed(0)}
            </span>
          ) : null}
        </div>
      )}
      {forecast.map((p) => (
        <div
          key={p.date}
          className="chip border border-dashed border-sky-400/50 bg-sky-400/5 text-ink/70"
          title={`Forecast ${fmtDate(p.date, { weekday: "long", month: "short", day: "numeric" })}`}
        >
          <span className="font-semibold text-sky-500">{fmtDate(p.date, { weekday: "short" })}</span>
          <span>
            {p.tmax !== null ? `${Math.round(p.tmax)}°` : "—"}
            {" / "}
            {p.tmin !== null ? `${Math.round(p.tmin)}°` : "—"}
          </span>
          {p.precip ? (
            <span className="inline-flex items-center gap-0.5 text-sky-500">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d={dropletPath()} />
              </svg>
              {p.precip.toFixed(0)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
