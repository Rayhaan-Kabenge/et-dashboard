"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, X, Minus } from "lucide-react";
import type { Alert } from "@/lib/types";

// Floating, persistent status-notice stack (bottom-right). Notices come from
// /api/state (state.alerts); this is display only — the backend notes/levels are
// unchanged. Never auto-dismisses; each card is dismissible; the whole stack can
// minimize to a badge. Dismissals are component-local (no localStorage) and reset
// on every new /api/state run so still-true notices reappear.

type Tier = "info" | "warning" | "critical";

// Display severity is driven by the backend `level`. Data-integrity load warnings
// (dropped weather rows / planting-date mismatch) arrive tagged "info" but read as
// warnings here — a frontend display choice; structured so `level` drives the rest.
function tierOf(a: Alert): Tier {
  if (a.level === "critical") return "critical";
  if (a.level === "warning" || a.code === "load_warning") return "warning";
  return "info";
}

const TIER: Record<Tier, { card: string; icon: string; Icon: typeof Info }> = {
  critical: { card: "border-status-now/30 bg-status-now/[0.06]", icon: "text-status-now", Icon: AlertTriangle },
  warning: { card: "border-status-soon/30 bg-status-soon/[0.09]", icon: "text-status-soon", Icon: AlertTriangle },
  info: { card: "border-water/25 bg-water/[0.06]", icon: "text-water", Icon: Info },
};
const ORDER: Record<Tier, number> = { critical: 0, warning: 1, info: 2 };

export default function StatusNotices({ alerts }: { alerts: Alert[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [minimized, setMinimized] = useState(false);

  const items = useMemo(
    () =>
      alerts
        .map((a, i) => ({ ...a, key: `${a.code}::${a.message}::${i}`, tier: tierOf(a) }))
        .sort((x, y) => ORDER[x.tier] - ORDER[y.tier]),
    [alerts]
  );

  // Re-derive from live state: a new run (refresh / crop toggle hands a fresh
  // alerts array) clears dismissals so still-true notices reappear. No persistence.
  useEffect(() => {
    setDismissed(new Set());
  }, [alerts]);

  // Mobile: open as the collapsed badge so the stack never covers controls.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) {
      setMinimized(true);
    }
  }, []);

  const visible = items.filter((it) => !dismissed.has(it.key));
  if (visible.length === 0) return null;

  const worst = visible.reduce<Tier>((acc, it) => (ORDER[it.tier] < ORDER[acc] ? it.tier : acc), "info");

  if (minimized) {
    const m = TIER[worst];
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        aria-label={`Show ${visible.length} status notice${visible.length === 1 ? "" : "s"}`}
        className={`fixed bottom-4 right-4 z-[1000] inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-card transition-colors hover:bg-soil-soft/30 ${m.card}`}
      >
        <m.Icon className={`h-3.5 w-3.5 ${m.icon}`} />
        <span className="text-ink">
          {visible.length} note{visible.length === 1 ? "" : "s"}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[1000] flex w-[min(92vw,360px)] flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="stat-label">Notices · {visible.length}</span>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          aria-label="Minimize notices"
          className="rounded-md p-1 text-muted transition-colors hover:bg-soil-soft/60 hover:text-ink"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
        {visible.map((it) => {
          const m = TIER[it.tier];
          return (
            <div
              key={it.key}
              role="status"
              className={`flex items-start gap-2 rounded-lg border ${m.card} px-3 py-2 shadow-card backdrop-blur-sm`}
            >
              <m.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${m.icon}`} />
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink/85">{it.message}</span>
              <button
                type="button"
                onClick={() => setDismissed((prev) => new Set(prev).add(it.key))}
                aria-label="Dismiss notice"
                className="-mr-0.5 -mt-0.5 shrink-0 rounded-md p-0.5 text-muted transition-colors hover:bg-soil-soft/60 hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
