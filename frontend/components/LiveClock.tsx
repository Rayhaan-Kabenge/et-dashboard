"use client";

import { useEffect, useState } from "react";

export default function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <span className="text-sm text-ink/50">—</span>;
  return (
    <span className="text-sm tabular-nums text-ink/60">
      {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
      {" · "}
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}
