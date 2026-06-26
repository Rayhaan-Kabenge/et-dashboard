"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, Info, KeyRound } from "lucide-react";
import { useField } from "@/lib/field/context";
import { postSummary } from "@/lib/field/api";
import CollapsibleCard from "./CollapsibleCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type Range = { start: string; end: string } | undefined;
type EngineContext = Record<string, unknown> | null;

interface SummaryResult {
  status: string;
  summary_text?: string | null;
  generated_at?: string | null;
  model?: string | null;
  message?: string | null;
}

export default function FieldSummary({
  range,
  index,
  engineContext,
}: {
  range: Range;
  index: string;
  engineContext: EngineContext;
}) {
  const { field } = useField();
  const [res, setRes] = useState<SummaryResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(force = false) {
    if (!field || range === undefined || !engineContext) return;
    setLoading(true);
    try {
      const r = await postSummary(field.id, { range, index, engine_context: engineContext }, force);
      setRes(r);
    } catch {
      setRes({ status: "error", message: "Summary unavailable right now." });
    } finally {
      setLoading(false);
    }
  }

  // generate once when the field/range/context is ready (cached server-side by fingerprint)
  useEffect(() => {
    if (field && range !== undefined && engineContext) run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field?.id, range?.start, range?.end]);

  const text = res?.summary_text;
  const unconfigured = res?.status === "unconfigured";

  return (
    <CollapsibleCard
      title="Field summary"
      subtitle="AI-generated · plain-language read"
      icon={Sparkles}
      right={
        <Button size="sm" variant="outline" onClick={() => run(true)} disabled={loading || !engineContext}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Regenerate
        </Button>
      }
    >
      {loading && !text ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-9/12" />
        </div>
      ) : unconfigured ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-hairline bg-soil-soft/20 py-8 text-center">
          <KeyRound className="h-6 w-6 text-muted" />
          <p className="max-w-sm text-sm text-muted">{res?.message || "Add an Anthropic key to enable the AI summary."}</p>
        </div>
      ) : text ? (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="water" className="gap-1"><Sparkles className="h-3 w-3" /> AI-generated</Badge>
            {res?.generated_at && (
              <span className="font-mono text-[11px] text-muted">{res.model} · {new Date(res.generated_at).toLocaleString()}</span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-ink/85">{text}</p>
          <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-soil-soft/30 px-3 py-2 text-[11px] text-muted">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>Advisory explanation of the model’s numbers. The irrigation recommendation comes from the model, not this summary.</span>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-hairline bg-soil-soft/20 py-8 text-center text-sm text-muted">
          {res?.message || "Generate a plain-language summary of this field."}
        </div>
      )}
    </CollapsibleCard>
  );
}
