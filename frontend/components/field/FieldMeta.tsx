"use client";

import { useState } from "react";
import { Ruler, Sprout, MapPin, CalendarDays, Trash2 } from "lucide-react";
import { useField } from "@/lib/field/context";
import { Button } from "@/components/ui/button";

export default function FieldMeta() {
  const { field, clearField } = useField();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  if (!field) return null;

  async function onClear() {
    setClearing(true);
    await clearField(); // sets the active field to null -> this card unmounts
  }

  return (
    <div className="rounded-xl2 border border-hairline bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="stat-label">Active field</div>
          <div className="text-lg font-semibold tracking-tight text-ink">{field.name}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {field.crop && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">
              <Sprout className="h-3.5 w-3.5" />
              {field.crop}
            </span>
          )}
          {confirming ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-hairline bg-soil-soft/30 px-2 py-1">
              <span className="text-xs text-muted">Remove this field and its boundary?</span>
              <Button size="sm" variant="outline" className="h-7 border-status-now/40 text-status-now hover:border-status-now hover:text-status-now" onClick={onClear} disabled={clearing}>
                {clearing ? "Removing…" : "Remove"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirming(false)} disabled={clearing}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="h-7 text-muted hover:text-status-now" onClick={() => setConfirming(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              Clear field
            </Button>
          )}
        </div>
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
