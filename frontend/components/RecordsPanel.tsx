"use client";

import { useState } from "react";
import { Download, Droplet, Sprout, CloudRain } from "lucide-react";
import type { StateResponse } from "@/lib/types";
import { useUnits, fmtDepth, toDisplay } from "@/lib/units";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import CardChevron from "@/components/CardChevron";

export default function RecordsPanel({ state }: { state: StateResponse }) {
  const { unit } = useUnits();
  const [open, setOpen] = useState(true);
  const s = state.season_summary;
  const events = state.schedule.filter((e) => e.applied > 0);
  const upcoming = state.schedule.filter((e) => e.is_forecast && e.applied === 0).slice(0, 4);

  const appliedTotal = s.total_applied_irrig + s.total_applied_fert;
  const maxBar = Math.max(s.total_etc, appliedTotal, s.effective_rainfall, 1);

  // CSV export — same daily series, unit-converted (behavior unchanged).
  function exportSeriesCsv() {
    const headers = [
      "date", "stage", "dap", `depletion_${unit}`, `ad_${unit}`, `etc_${unit}`,
      `etr_${unit}`, "kcr", `applied_${unit}`, `precip_${unit}`, "is_forecast",
    ];
    const conv = (v: number | null) =>
      v === null || v === undefined ? "" : (toDisplay(v, unit) as number).toFixed(unit === "in" ? 3 : 2);
    const rows = state.series.map((p) =>
      [
        p.date, p.stage, p.dap, conv(p.depletion), conv(p.ad), conv(p.etc), conv(p.etr),
        p.kcr === null ? "" : p.kcr.toFixed(3), conv(p.applied), conv(p.precip),
        p.is_forecast ? "forecast" : "actual",
      ].join(",")
    );
    download(`${slug(state.site.name)}_${state.site.season}_daily_${unit}.csv`, [headers.join(","), ...rows].join("\n"));
  }

  return (
    <section className="rounded-xl2 border border-hairline bg-card shadow-card">
      <div className="flex items-center justify-between p-5 pb-4">
        <div className="flex items-center gap-2">
          <CardChevron open={open} onClick={() => setOpen((o) => !o)} label="records" />
          <div>
            <div className="stat-label">Records &amp; water budget</div>
            <h3 className="text-base font-semibold tracking-tight text-ink">Season to date</h3>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportSeriesCsv}>
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {open && (
      <div className="grid gap-6 px-5 pb-5 lg:grid-cols-[1.1fr_1fr]">
        {/* water budget */}
        <div>
          <div className="grid grid-cols-3 gap-3">
            <Stat icon={Sprout} label="Cumulative ETc" value={fmtDepth(s.total_etc, unit)} tone="brand" />
            <Stat icon={Droplet} label="Water applied" value={fmtDepth(appliedTotal, unit)} tone="water" />
            <Stat icon={CloudRain} label="Effective rain" value={fmtDepth(s.effective_rainfall, unit)} tone="soil" />
          </div>
          <div className="mt-5 space-y-3">
            <Bar label="ETc demand" value={s.total_etc} max={maxBar} unit={unit} color="var(--brand)" />
            <Bar label="Applied (irrig+fert)" value={appliedTotal} max={maxBar} unit={unit} color="var(--water)" />
            <Bar label="Effective rainfall" value={s.effective_rainfall} max={maxBar} unit={unit} color="var(--soil)" />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
            <span>{s.irrigation_events} irrig · {fmtDepth(s.total_applied_irrig, unit)}</span>
            <span>{s.fertigation_events} fert · {fmtDepth(s.total_applied_fert, unit)}</span>
            <span>total rain {fmtDepth(s.total_rainfall, unit)}</span>
          </div>
        </div>

        {/* irrigation log */}
        <div>
          <div className="stat-label mb-2">Irrigation log</div>
          {events.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hairline p-4 text-sm text-muted">
              No water applied yet this season.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-hairline">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Applied</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.date}>
                      <TableCell className="font-mono text-ink/80">{fmtDate(e.date, { month: "short", day: "numeric", year: "numeric" })}</TableCell>
                      <TableCell>
                        <Badge variant={e.type === "Fert" ? "water" : "soft"} className="px-2 py-0">{e.type}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums text-ink">{fmtDepth(e.applied, unit)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {upcoming.length > 0 && (
            <div className="mt-3 font-mono text-[11px] text-muted">
              next candidate: {upcoming.map((e) => fmtDate(e.date)).join(", ")}
            </div>
          )}
        </div>
      </div>
      )}
    </section>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Droplet; label: string; value: string; tone: "brand" | "water" | "soil" }) {
  const color = tone === "brand" ? "text-brand" : tone === "water" ? "text-water" : "text-soil-deep";
  return (
    <div className="rounded-lg bg-ink/[0.02] p-3">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <div className="stat-label">{label}</div>
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Bar({ label, value, max, unit, color }: { label: string; value: number; max: number; unit: any; color: string }) {
  const pct = Math.max(2, (value / max) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono font-medium tabular-nums text-ink">{fmtDepth(value, unit)}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink/[0.06]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
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
