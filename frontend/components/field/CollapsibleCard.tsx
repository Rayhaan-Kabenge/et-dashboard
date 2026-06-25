"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

export default function CollapsibleCard({
  title,
  subtitle,
  icon: Icon,
  right,
  defaultOpen = true,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: typeof ChevronDown;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="overflow-hidden rounded-xl2 border border-hairline bg-card shadow-card">
      <div className="flex items-center justify-between gap-3 p-4">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          className="flex min-w-0 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
          {Icon && <Icon className="h-4 w-4 shrink-0 text-water" />}
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold tracking-tight text-ink">{title}</span>
            {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
          </span>
        </button>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {open && (
        <div id={id} className="px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}
