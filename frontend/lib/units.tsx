"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

// Display-only unit handling. The engine is ALWAYS metric (mm); this toggle never
// changes anything sent to the backend — it only converts depth quantities for
// display (depletion, AD, ETc, ETr, applied water, precip).

export type Unit = "mm" | "in";
const MM_PER_IN = 25.4;

interface UnitsCtx {
  unit: Unit;
  setUnit: (u: Unit) => void;
  toggle: () => void;
}

const Ctx = createContext<UnitsCtx>({ unit: "mm", setUnit: () => {}, toggle: () => {} });

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnit] = useState<Unit>("mm");

  useEffect(() => {
    const saved = (typeof window !== "undefined" && window.localStorage.getItem("et-unit")) as Unit | null;
    if (saved === "mm" || saved === "in") setUnit(saved);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("et-unit", unit);
  }, [unit]);

  const value = useMemo<UnitsCtx>(
    () => ({ unit, setUnit, toggle: () => setUnit((u) => (u === "mm" ? "in" : "mm")) }),
    [unit]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnits() {
  return useContext(Ctx);
}

// --- pure conversion/format helpers (unit passed explicitly) ---------------
export function toDisplay(mm: number | null | undefined, unit: Unit): number | null {
  if (mm === null || mm === undefined) return null;
  return unit === "in" ? mm / MM_PER_IN : mm;
}

export function fmtDepth(mm: number | null | undefined, unit: Unit, digits?: number): string {
  if (mm === null || mm === undefined) return "—";
  const v = toDisplay(mm, unit)!;
  const d = digits ?? (unit === "in" ? 2 : 1);
  return `${v.toFixed(d)} ${unit}`;
}

export function fmtDepthValue(mm: number | null | undefined, unit: Unit, digits?: number): string {
  if (mm === null || mm === undefined) return "—";
  const v = toDisplay(mm, unit)!;
  const d = digits ?? (unit === "in" ? 2 : 1);
  return v.toFixed(d);
}

export function unitLabel(unit: Unit): string {
  return unit;
}
