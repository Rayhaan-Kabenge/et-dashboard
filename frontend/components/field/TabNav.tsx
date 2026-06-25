"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sprout, Satellite } from "lucide-react";
import { FIELD_HEALTH_ENABLED } from "@/lib/features";

const TABS = [
  { href: "/", label: "Irrigation", Icon: Sprout },
  { href: "/field-health", label: "Field health", Icon: Satellite },
];

export default function TabNav() {
  const pathname = usePathname();
  if (!FIELD_HEALTH_ENABLED) return null;

  return (
    <div className="border-b border-hairline bg-card">
      <nav className="mx-auto flex max-w-7xl items-center gap-1 px-4 lg:px-8" aria-label="Sections">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                active
                  ? "border-brand text-brand"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <t.Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
