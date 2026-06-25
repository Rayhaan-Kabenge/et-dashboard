"use client";

import { AlertTriangle, Info, Clock } from "lucide-react";
import type { Alert } from "@/lib/types";

const META: Record<Alert["level"], { cls: string; Icon: typeof Info }> = {
  critical: { cls: "border-status-now/30 bg-status-now/[0.07] text-status-now", Icon: AlertTriangle },
  warning: { cls: "border-status-soon/30 bg-status-soon/[0.08] text-status-soon", Icon: Clock },
  info: { cls: "border-water/25 bg-water/[0.06] text-water", Icon: Info },
};

export default function AlertsBar({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null;
  const order = { critical: 0, warning: 1, info: 2 } as const;
  const sorted = [...alerts].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <div className="flex flex-col gap-2">
      {sorted.map((a, i) => {
        const m = META[a.level];
        return (
          <div key={i} className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium ${m.cls}`} role="status">
            <m.Icon className="h-4 w-4 shrink-0" />
            <span>{a.message}</span>
          </div>
        );
      })}
    </div>
  );
}
