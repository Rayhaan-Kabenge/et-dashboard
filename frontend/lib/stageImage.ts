// Maps a crop-stage label to its photo in /public/stages, with a graceful
// fallback when a given stage's image is missing (e.g. R5.5).

// Web-safe slugs present in frontend/public/stages/ (one photo per stage).
export const AVAILABLE_STAGE_SLUGS = new Set([
  "p", "ve",
  "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11", "v12", "v13", "v14",
  "vt_r1", "r2", "r3", "r4", "r4_7", "r5_25", "r5_75", "r6",
]);

// Sorghum stage photos in frontend/public/stages/sorghum/ (labels match the sheet).
export const SORGHUM_STAGE_SLUGS = new Set([
  "emergence", "3-leaf", "4-leaf", "5-leaf", "gdp", "flag_leaf",
  "boot", "heading", "flowering", "soft_dough", "hard_dough", "black_layer",
]);

// Per-crop image set + public path. Corn keeps the existing /stages root; each
// other crop is namespaced under /stages/<crop>/.
function cropImages(crop: string): { slugs: Set<string>; base: string } {
  if (crop === "sorghum") return { slugs: SORGHUM_STAGE_SLUGS, base: "/stages/sorghum" };
  return { slugs: AVAILABLE_STAGE_SLUGS, base: "/stages" };
}

// lowercase; drop parenthetical notes ("Soft dough (forage harvest)" -> "soft_dough");
// "/", ":" and "." -> "_" (e.g. "VT/R1" -> "vt_r1", "R4.7" -> "r4_7"). Hyphens kept.
export function stageSlug(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\([^)]*\)/g, "")
    .replace(/[/:.\s]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Resolve the image path for `label` in the active crop's stage set. If that
 * stage has no image, walk backward through `order` (phenological order) and
 * return the most recent stage that does. Returns null when nothing resolves
 * (caller renders the generic illustration fallback).
 */
export function resolveStageImage(label: string, order: string[], crop: string = "corn"): string | null {
  const { slugs, base } = cropImages(crop);
  const direct = stageSlug(label);
  if (slugs.has(direct)) return `${base}/${direct}.png`;
  const idx = order.indexOf(label);
  if (idx >= 0) {
    for (let i = idx - 1; i >= 0; i--) {
      const s = stageSlug(order[i]);
      if (slugs.has(s)) return `${base}/${s}.png`;
    }
  }
  return null;
}
