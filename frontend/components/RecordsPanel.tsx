"use client";

import type { StateResponse } from "@/lib/types";
import { useUnits, fmtDepth, toDisplay } from "@/lib/units";
import { fmtDate } from "@/lib/format";

export default function RecordsPanel({ state }: { state: StateResponse }) {
  const { unit } = useUnits();
  const s = state.season_summary;
  const events = state.schedule.filter((e) => e.applied > 0);
  const upcoming = state.schedule.filter((e) => e.is_forecast && e.applied === 0).slice(0, 4);

  const appliedTotal = s.total_applied_irrig + s.total_applied_fert;
  const maxBar = Math.max(s.total_etc, appliedTotal, s.effective_rainfall, 1);

  function exportSeriesCsv() {
    const headers = [
      "date",
      "stage",
      "dap",
      `depletion_${unit}`,
      `ad_${unit}`,
      `etc_${unit}`,
      `etr_${unit}`,
      "kcr",
      `applied_${unit}`,
      `precip_${unit}`,
      "is_forecast",
    ];
    const conv = (v: number | null) => (v === null || v === undefined ? "" : (toDisplay(v, unit) as number).toFixed(unit === "in" ? 3 : 2));
    const rows = state.series.map((p) =>
      [
        p.date,
        p.stage,
        p.dap,
        conv(p.depletion),
        conv(p.ad),
        conv(p.etc),
        conv(p.etr),
        p.kcr === null ? "" : p.kcr.toFixed(3),
        conv(p.applied),
        conv(p.precip),
        p.is_forecast ? "forecast" : "actual",
      ].join(",")
    );
    download(`${slug(state.site.name)}_${state.site.season}_daily_${unit}.csv`, [headers.join(","), ...rows].join("\n"));
  }

  return (
    <section className="card p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">Records &amp; water budget</h3>
          <p className="text-sm text-ink/50">Season-to-date, from the model output.</p>
        </div>
        <button
          onClick={exportSeriesCsv}
          className="chip border border-black/10 bg-white text-ink/70 hover:border-leaf-500 hover:text-leaf-700"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth={2}>
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Export CSV
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* water budget */}
        <div>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Cumulative ETc" value={fmtDepth(s.total_etc, unit)} tone="leaf" />
            <Stat label="Water applied" value={fmtDepth(appliedTotal, unit)} tone="sky" />
            <Stat label="Effective rain" value={fmtDepth(s.effective_rainfall, unit)} tone="soil" />
          </div>
          <div className="mt-5 space-y-3">
            <Bar label="ETc demand" value={s.total_etc} max={maxBar} unit={unit} color="bg-leaf-500" />
            <Bar label="Applied (irrig+fert)" value={appliedTotal} max={maxBar} unit={unit} color="bg-sky-500" />
            <Bar label="Effective rainfall" value={s.effective_rainfall} max={maxBar} unit={unit} color="bg-soil-500" />
          </div>
          <div className="mt-4 flex gap-4 text-xs text-ink/50">
            <span>{s.irrigation_events} irrigation{s.irrigation_events === 1 ? "" : "s"} · {fmtDepth(s.total_applied_irrig, unit)}</span>
            <span>{s.fertigation_events} fertigation{s.fertigation_events === 1 ? "" : "s"} · {fmtDepth(s.total_applied_fert, unit)}</span>
            <span>Total rain {fmtDepth(s.total_rainfall, unit)}</span>
          </div>
        </div>

        {/* irrigation log */}
        <div>
          <div className="stat-label mb-2">Irrigation log</div>
          {events.length === 0 ? (
            <div className="rounded-lg border border-dashed border-black/10 p-4 text-sm text-ink/50">
              No water applied yet this season.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-black/5">
              <table className="w-full text-sm">
                <thead className="bg-black/[0.025] text-left text-xs uppercase tracking-wide text-ink/45">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 text-right font-medium">Applied</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {events.map((e) => (
                    <tr key={e.date} className="hover:bg-leaf-50/50">
                      <td className="px-3 py-2 text-ink/80">{fmtDate(e.date, { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td className="px-3 py-2">
                        <span className={`chip !px-2 !py-0.5 text-xs ${e.type === "Fert" ? "bg-sky-400/15 text-sky-500" : "bg-leaf-50 text-leaf-700"}`}>
                          {e.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">{fmtDepth(e.applied, unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {upcoming.length > 0 && (
            <div className="mt-3 text-xs text-ink/50">
              Next candidate dates:{" "}
              {upcoming.map((e, i) => (
                <span key={e.date}>
                  {fmtDate(e.date)}
                  {i < upcoming.length - 1 ? ", " : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "leaf" | "sky" | "soil" }) {
  const color = tone === "leaf" ? "text-leaf-700" : tone === "sky" ? "text-sky-500" : "text-soil-600";
  return (
    <div className="rounded-lg bg-black/[0.02] p-3">
      <div className="stat-label">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Bar({ label, value, max, unit, color }: { label: string; value: number; max: number; unit: string; color: string }) {
  const pct = Math.max(2, (value / max) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-ink/60">{label}</span>
        <span className="font-medium tabular-nums text-ink">{fmtDepth(value, unit as any)}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/5">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
