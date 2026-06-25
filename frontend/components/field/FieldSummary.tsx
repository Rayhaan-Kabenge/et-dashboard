"use client";

import { useState } from "react";
import { Sparkles, Lock } from "lucide-react";
import { useField } from "@/lib/field/context";
import { postSummary } from "@/lib/field/api";
import CollapsibleCard from "./CollapsibleCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function FieldSummary() {
  const { field } = useField();
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!field) return;
    setLoading(true);
    try {
      const r = await postSummary(field.id);
      setMsg(r.message);
    } catch {
      setMsg("Summary unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <CollapsibleCard
      title="Field summary"
      subtitle="Plain-language assessment"
      icon={Sparkles}
      right={<Badge variant="outline">coming soon</Badge>}
    >
      <div className="rounded-lg border border-dashed border-hairline bg-soil-soft/20 p-5">
        <p className="max-w-prose text-sm text-muted">
          A plain-language read of this field — vegetation trend, flagged anomalies, and growth-stage
          context — will appear here, generated from the computed index &amp; ET values.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={generate} disabled={loading || !field}>
            <Sparkles className="h-3.5 w-3.5" />
            {loading ? "Generating…" : "Generate summary"}
          </Button>
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted">
            <Lock className="h-3 w-3" /> v2
          </span>
        </div>
        {msg && (
          <p className="mt-3 rounded-md bg-card px-3 py-2 text-sm text-ink/80">{msg}</p>
        )}
      </div>
    </CollapsibleCard>
  );
}
