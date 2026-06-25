// Build-time feature flags. NEXT_PUBLIC_* values are inlined at build.
// When off, the Field Health tab is hidden and the app is identical to today.
export const FIELD_HEALTH_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_FIELD_HEALTH === "true";
