"use client";

import { Ruler, Sprout, MapPin, CalendarDays } from "lucide-react";
import { useField } from "@/lib/field/context";

export default function FieldMeta() {
  const { field } = useField();
  if (!field) return null;
  return (
    <div className="rounded-xl2 border border-hairline bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="stat-label">Active field</div>
          <div className="text-lg font-semibold tracking-tight text-ink">{field.name}</div>
        </div>
        {field.crop && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">
            <Sprout className="h-3.5 w-3.5" />
            {field.crop}
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Meta icon={Ruler} label="Area" value={`${field.area_acres.toFixed(1)} ac`} />
        <Meta icon={MapPin} label="Centroid" value={`${field.centroid[1].toFixed(4)}, ${field.centroid[0].toFixed(4)}`} />
        <Meta icon={CalendarDays} label="Created" value={new Date(field.created_at).toLocaleDateString()} />
      </div>
    </div>
  );
}

function Meta({ icon: Icon, label, value }: { icon: typeof Ruler; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      <div className="min-w-0">
        <div className="stat-label">{label}</div>
        <div className="truncate font-mono text-sm font-semibold text-ink">{value}</div>
      </div>
    </div>
  );
}
