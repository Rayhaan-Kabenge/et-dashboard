// Small display helpers (dates, numbers). No domain logic here.

export function fmtDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString(undefined, opts ?? { month: "short", day: "numeric" });
}

export function fmtDateLong(iso: string | null | undefined): string {
  return fmtDate(iso, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "—";
  return v.toFixed(digits);
}

export function fmtTemp(c: number | null | undefined): string {
  if (c === null || c === undefined) return "—";
  return `${Math.round(c)}°C`;
}
