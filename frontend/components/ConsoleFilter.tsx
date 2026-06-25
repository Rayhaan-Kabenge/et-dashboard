"use client";

import { useEffect } from "react";

// Silences ONLY the known Recharts 2.x "defaultProps will be removed" deprecation
// warning (a library-internal notice, not an app error). Everything else passes through.
export default function ConsoleFilter() {
  useEffect(() => {
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === "string" && first.includes("defaultProps")) return;
      orig(...(args as []));
    };
    return () => {
      console.error = orig;
    };
  }, []);
  return null;
}
