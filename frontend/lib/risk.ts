import { API_BASE } from "@/lib/api";

// Per-zone Bayesian risk posteriors (mirror backend/app/farm/schemas.py +
// risk_posteriors.json). Display-only: the skew-normal μ/σ/α were fit offline;
// here we just render the three-zone distributions as the risk landscape.

export interface CI {
  mean: number;
  lower: number;
  upper: number;
}
export interface BandParams {
  mu: CI;
  sigma: CI;
  alpha: CI;
}
export interface MetricMeta {
  label: string;
  units: string;
  higher_is_better: boolean;
}
export interface Metric {
  meta: MetricMeta;
  by_zone: Record<string, BandParams>;
}
export interface ZoneBand {
  ratio_min: number | null;
  ratio_max: number | null;
  label: string;
}
export interface RiskResponse {
  status: "ok" | "unavailable";
  zone_id: string;
  zone_crop: string;
  zone_name?: string | null;
  model_crop?: string | null;
  ratio_basis?: string | null;
  distribution?: string | null;
  zone_bands?: Record<string, ZoneBand> | null;
  zone_observations?: Record<string, number> | null;
  metric_display_order?: string[] | null;
  metrics?: Record<string, Metric> | null;
  caveats?: string[];
  source?: string | null;
  message?: string | null;
}

export async function getRisk(zoneId: string): Promise<RiskResponse> {
  const res = await fetch(`${API_BASE}/api/risk?zone_id=${encodeURIComponent(zoneId)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// --- band identity ----------------------------------------------------------
export const BAND_ORDER = ["Below", "Target", "Above"] as const;
export type BandKey = (typeof BAND_ORDER)[number];

// Below = deficit (amber caution) · Target = in-window (green) · Above = extra
// water applied (blue, neutral — not an alarm: yield is often similar, just less
// certain and costlier).
export const BAND_COLOR: Record<string, string> = {
  Below: "var(--status-soon)",
  Target: "var(--brand)",
  Above: "var(--water)",
};

export interface Confidence {
  label: string;
  color: string;
}
// Honest confidence from the observation count — small n => wider, less certain.
export function confidenceOf(n: number | undefined): Confidence {
  if (n == null) return { label: "—", color: "var(--muted)" };
  if (n >= 200) return { label: `well-sampled · n=${n}`, color: "var(--brand)" };
  if (n >= 30) return { label: `moderate · n=${n}`, color: "var(--status-soon)" };
  return { label: `data-thin · n=${n}`, color: "var(--status-now)" };
}

// --- skew-normal density + quantiles ---------------------------------------
function normPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}
// Abramowitz–Stegun 7.1.26 error-function approximation (|err| < 1.5e-7).
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
export function skewPdf(x: number, xi: number, omega: number, alpha: number): number {
  if (omega <= 0) return 0;
  const z = (x - xi) / omega;
  return (2 / omega) * normPdf(z) * normCdf(alpha * z);
}

export interface BandCurve {
  band: string;
  x: number[];
  pdfNorm: number[]; // density scaled so the metric's global peak = 1 (for drawing)
  median: number;
  p05: number;
  p95: number; // outcome spread (variability)
  credLo: number;
  credHi: number; // 95% credible interval on the median (estimation uncertainty, n-driven)
  n?: number;
}

// Rough support for one band: ±4σ around the location, skew handled by the grid.
function bandSupport(p: BandParams): [number, number] {
  return [p.mu.mean - 4 * p.sigma.mean, p.mu.mean + 4 * p.sigma.mean];
}

function quantile(x: number[], cdf: number[], total: number, pp: number): number {
  const target = pp * total;
  for (let i = 0; i < cdf.length; i++) {
    if (cdf[i] >= target) {
      const prev = i > 0 ? cdf[i - 1] : 0;
      const denom = cdf[i] - prev || 1;
      const frac = (target - prev) / denom;
      const xPrev = i > 0 ? x[i - 1] : x[0];
      return xPrev + frac * (x[i] - xPrev);
    }
  }
  return x[x.length - 1];
}

/**
 * Build drawable density curves + honest intervals for all bands of a metric on a
 * SHARED domain (so the three are directly comparable). The median is
 * translation-equivariant in μ, so the 95% credible interval on the median is the
 * μ credible interval carried onto the median — this is what widens for small n.
 */
export function metricCurves(metric: Metric, samples = 100): BandCurve[] {
  const bands = BAND_ORDER.filter((b) => metric.by_zone[b]);
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bands) {
    const [a, z] = bandSupport(metric.by_zone[b]);
    lo = Math.min(lo, a);
    hi = Math.max(hi, z);
  }
  const step = (hi - lo) / (samples - 1);

  const raw = bands.map((band) => {
    const p = metric.by_zone[band];
    const xi = p.mu.mean;
    const omega = p.sigma.mean;
    const a = p.alpha.mean;
    const x: number[] = [];
    const pdf: number[] = [];
    const cdf: number[] = [];
    let cum = 0;
    for (let i = 0; i < samples; i++) {
      const xv = lo + i * step;
      const d = skewPdf(xv, xi, omega, a);
      x.push(xv);
      pdf.push(d);
      cum += d;
      cdf.push(cum);
    }
    const total = cum || 1;
    const median = quantile(x, cdf, total, 0.5);
    return {
      band,
      x,
      pdf,
      median,
      p05: quantile(x, cdf, total, 0.05),
      p95: quantile(x, cdf, total, 0.95),
      credLo: median + (p.mu.lower - p.mu.mean),
      credHi: median + (p.mu.upper - p.mu.mean),
    };
  });

  const peak = Math.max(...raw.flatMap((r) => r.pdf), 1e-9);
  return raw.map((r) => ({
    band: r.band,
    x: r.x,
    pdfNorm: r.pdf.map((d) => d / peak),
    median: r.median,
    p05: r.p05,
    p95: r.p95,
    credLo: r.credLo,
    credHi: r.credHi,
  }));
}

export function metricDomain(curves: BandCurve[]): [number, number] {
  const xs = curves.flatMap((c) => c.x);
  return [Math.min(...xs), Math.max(...xs)];
}

export function fmtVal(v: number, units: string): string {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const s = v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return units === "$/ac" ? `$${s}` : s;
}
