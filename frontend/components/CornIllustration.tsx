"use client";

// Parametric corn plant: height, leaf count, tassel and ear emerge with progress.
// progress: 0 (planting) .. 1 (maturity).
export default function CornIllustration({ progress }: { progress: number }) {
  const p = Math.max(0, Math.min(1, progress));
  const groundY = 150;
  const maxH = 122;
  const h = 14 + maxH * Math.pow(p, 0.82); // eased growth
  const topY = groundY - h;
  const leaves = Math.min(8, Math.floor(2 + p * 7));
  const tassel = p > 0.62;
  const ear = p > 0.55;
  const mature = p > 0.86;
  const stalk = mature ? "var(--soil)" : "var(--brand-accent)";
  const leafColor = mature ? "var(--amber)" : "var(--brand-accent)";

  const leafNodes = Array.from({ length: leaves }, (_, i) => {
    const t = (i + 1) / (leaves + 1);
    const ly = groundY - h * t;
    const side = i % 2 === 0 ? 1 : -1;
    const span = 24 + 20 * Math.sin(t * Math.PI); // widest mid-plant
    const droop = 10 + 8 * t;
    return (
      <path
        key={i}
        d={`M80 ${ly} Q ${80 + side * span * 0.6} ${ly - 6} ${80 + side * span} ${ly + droop}`}
        fill="none"
        stroke={leafColor}
        strokeWidth={4.5}
        strokeLinecap="round"
      />
    );
  });

  return (
    <svg viewBox="0 0 160 168" className="h-44 w-full" role="img" aria-label="corn growth stage">
      {/* soil */}
      <rect x="0" y={groundY} width="160" height="18" rx="3" fill="var(--soil-deep)" opacity="0.18" />
      <line x1="14" y1={groundY + 7} x2="146" y2={groundY + 7} stroke="var(--soil-deep)" strokeOpacity="0.25" strokeDasharray="2 5" strokeWidth="1.5" />

      {/* stalk */}
      <line x1="80" y1={groundY} x2="80" y2={topY} stroke={stalk} strokeWidth={5.5} strokeLinecap="round" />

      {leafNodes}

      {/* ear */}
      {ear && (
        <g>
          <ellipse cx={92} cy={groundY - h * 0.42} rx={7} ry={13} fill="var(--amber)" transform={`rotate(20 92 ${groundY - h * 0.42})`} />
        </g>
      )}

      {/* tassel */}
      {tassel && (
        <g stroke={mature ? "var(--amber)" : "var(--brand-accent)"} strokeWidth="2.2" strokeLinecap="round">
          <line x1="80" y1={topY} x2="80" y2={topY - 14} />
          <line x1="80" y1={topY} x2="72" y2={topY - 11} />
          <line x1="80" y1={topY} x2="88" y2={topY - 11} />
          <line x1="80" y1={topY} x2="76" y2={topY - 13} />
          <line x1="80" y1={topY} x2="84" y2={topY - 13} />
        </g>
      )}

      {/* seedling sprout cap when very young */}
      {p < 0.12 && <circle cx="80" cy={topY} r="4" fill="var(--brand-accent)" />}
    </svg>
  );
}
