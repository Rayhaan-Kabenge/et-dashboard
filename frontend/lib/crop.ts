"use client";

import { useEffect, useState } from "react";

// The active crop is a READ-ONLY alias of the active zone's crop. Zone selection
// is the single selector: setActiveZone (lib/zones) writes ?zone= AND ?crop=
// together and fires "cropchange", so crop can never diverge from the zone. There
// is deliberately NO setter here — nothing may set crop independently (that was
// the old crop-toggle desync path; the toggle is gone). `?crop=` survives refresh
// and stays shareable; consumers only read it.
export const DEFAULT_CROP = "corn";

export function readCrop(): string {
  if (typeof window === "undefined") return DEFAULT_CROP;
  const c = new URLSearchParams(window.location.search).get("crop");
  return c ? c.trim().toLowerCase() : DEFAULT_CROP;
}

export function useCrop() {
  const [crop, setCropState] = useState<string>(DEFAULT_CROP);

  useEffect(() => {
    const sync = () => setCropState(readCrop());
    sync(); // adopt the URL's crop on mount
    window.addEventListener("popstate", sync);
    window.addEventListener("cropchange", sync); // fired by setActiveZone
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("cropchange", sync);
    };
  }, []);

  return { crop };
}
