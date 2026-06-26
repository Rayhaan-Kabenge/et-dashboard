"use client";

import { useCallback, useEffect, useState } from "react";

// Active crop lives in the URL (?crop=corn|sorghum) so it survives refresh and is
// shareable. Shared by both tabs. Default is corn when absent. We read/write the
// param via window.history (no useSearchParams → no Suspense-boundary build dance)
// and broadcast a "cropchange" event so every consumer in the tab stays in sync.
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
    window.addEventListener("cropchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("cropchange", sync);
    };
  }, []);

  // URL is the single source of truth: update it, then let the event re-read.
  const setCrop = useCallback((next: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("crop", next);
    window.history.replaceState(window.history.state, "", url.toString());
    window.dispatchEvent(new Event("cropchange"));
  }, []);

  return { crop, setCrop };
}
