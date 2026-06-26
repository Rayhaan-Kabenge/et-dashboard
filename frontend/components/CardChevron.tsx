"use client";

import { ChevronDown } from "lucide-react";

// Shared collapse/expand toggle for the Irrigation-tab cards. Display-only; each
// card owns its own open state and conditionally renders its body.
export default function CardChevron({
  open,
  onClick,
  label,
  className = "",
}: {
  open: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
      className={`shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-soil-soft/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${className}`}
    >
      <ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />
    </button>
  );
}
