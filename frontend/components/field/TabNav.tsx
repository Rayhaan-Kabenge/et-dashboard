"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sprout, Satellite } from "lucide-react";
import { FIELD_HEALTH_ENABLED } from "@/lib/features";
import { useCrop, DEFAULT_CROP } from "@/lib/crop";
import CropToggle from "@/components/CropToggle";

const TABS = [
  { href: "/", label: "Irrigation", Icon: Sprout },
  { href: "/field-health", label: "Field health", Icon: Satellite },
];

export default function TabNav() {
  const pathname = usePathname();
  const { crop } = useCrop();
  if (!FIELD_HEALTH_ENABLED) return null;

  // carry the active crop across tab switches so both tabs stay in sync
  const withCrop = (href: string) => (crop && crop !== DEFAULT_CROP ? `${href}?crop=${crop}` : href);

  return (
    <div className="border-b border-hairline bg-card">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-1 px-4 lg:px-8" aria-label="Sections">
        <div className="flex items-center gap-1">
          {TABS.map((t) => {
            const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={withCrop(t.href)}
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
        </div>
        <CropToggle />
      </nav>
    </div>
  );
}
