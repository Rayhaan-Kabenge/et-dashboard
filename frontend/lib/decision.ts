import type { Decision } from "./types";

// Display-only status bucket for the status-color system (hero, meter, chart
// threshold, alerts). This does NOT change any computed number or the engine's
// irrigation decision — it only chooses an emphasis color/label from values
// already in the API response (should_irrigate_now, depletion, ad, days_to_trigger).
export type Status = "now" | "soon" | "hold" | "none";

export function statusOf(d: Decision | null | undefined): Status {
  if (!d) return "none";
  if (d.should_irrigate_now) return "now";
  if (d.ad == null || d.depletion == null) return "none";
  // "soon" = genuinely approaching AD, so the hero never contradicts the engine's
  // "Hold" call: within ~20% of AD, or the trigger is ≤ 2 days out.
  const headroomFrac = d.ad > 0 ? (d.ad - d.depletion) / d.ad : 0;
  const approaching = headroomFrac <= 0.2 || (d.days_to_trigger != null && d.days_to_trigger <= 2);
  return approaching ? "soon" : "hold";
}

export interface StatusMeta {
  key: Status;
  label: string;
  sub: string;
  cssVar: string; // CSS custom property for inline fills (charts/meter)
  badge: "hold" | "soon" | "now" | "outline";
}

export const STATUS_META: Record<Status, StatusMeta> = {
  now: { key: "now", label: "Irrigate today", sub: "Past allowable depletion", cssVar: "var(--status-now)", badge: "now" },
  soon: { key: "soon", label: "Irrigate soon", sub: "Approaching allowable depletion", cssVar: "var(--status-soon)", badge: "soon" },
  hold: { key: "hold", label: "Hold", sub: "Soil water comfortable", cssVar: "var(--status-hold)", badge: "hold" },
  none: { key: "none", label: "Monitoring", sub: "Allowable depletion not defined at this stage", cssVar: "var(--muted)", badge: "outline" },
};

export function statusMeta(d: Decision | null | undefined): StatusMeta {
  return STATUS_META[statusOf(d)];
}
