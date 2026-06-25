"use client";

import type { Alert } from "@/lib/types";

const STYLES: Record<Alert["level"], string> = {
  critical: "bg-clay-500/10 text-clay-500 border-clay-400/40",
  warning: "bg-amber-400/10 text-amber-500 border-amber-400/40",
  info: "bg-sky-400/10 text-sky-500 border-sky-400/30",
};

function Icon({ level }: { level: Alert["level"] }) {
  if (level === "critical")
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2}>
        <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v4h1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AlertsBar({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null;
  // surface non-info alerts first
  const order = { critical: 0, warning: 1, info: 2 } as const;
  const sorted = [...alerts].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <div className="flex flex-col gap-2">
      {sorted.map((a, i) => (
        <div key={i} className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium ${STYLES[a.level]}`}>
          <Icon level={a.level} />
          <span>{a.message}</span>
        </div>
      ))}
    </div>
  );
}
