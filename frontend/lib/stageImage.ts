// Maps a crop-stage label to its photo in /public/stages, with a graceful
// fallback when a given stage's image is missing (e.g. R5.5).

// Web-safe slugs present in frontend/public/stages/ (one photo per stage).
export const AVAILABLE_STAGE_SLUGS = new Set([
  "p", "ve",
  "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11", "v12", "v13", "v14",
  "vt_r1", "r2", "r3", "r4", "r4_7", "r5_25", "r5_75", "r6",
]);

// lowercase; "/", ":" and "." -> "_" (e.g. "VT/R1" -> "vt_r1", "R4.7" -> "r4_7").
export function stageSlug(label: string): string {
  return label.toLowerCase().trim().replace(/[/:.\s]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Resolve the /stages image path for `label`. If that stage has no image, walk
 * backward through `order` (phenological order) and return the most recent stage
 * that does. Returns null when nothing resolves (caller renders a fallback).
 */
export function resolveStageImage(label: string, order: string[]): string | null {
  const direct = stageSlug(label);
  if (AVAILABLE_STAGE_SLUGS.has(direct)) return `/stages/${direct}.png`;
  const idx = order.indexOf(label);
  if (idx >= 0) {
    for (let i = idx - 1; i >= 0; i--) {
      const s = stageSlug(order[i]);
      if (AVAILABLE_STAGE_SLUGS.has(s)) return `/stages/${s}.png`;
    }
  }
  return null;
}
