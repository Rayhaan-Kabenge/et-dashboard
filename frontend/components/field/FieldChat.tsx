"use client";

import { useEffect, useRef, useState } from "react";
import {
  MessageCircle, X, Send, Sparkles, Trash2, Info, KeyRound, Loader2, MapPin,
} from "lucide-react";
import { useField } from "@/lib/field/context";
import { useCrop } from "@/lib/crop";
import { postChat, type ChatMessage } from "@/lib/field/api";

type Range = { start: string; end: string } | undefined;
type EngineContext = Record<string, unknown> | null;

// Floating "Ask about this field" launcher (Field Health tab only). Grounded on
// the SAME numeric block as the v2 summary — index trend, OpenET ET gap, and the
// engine context from /api/state (passed in). Advisory only; the model never
// overrides the engine's call (enforced server-side). Field- and crop-aware.
const STARTERS = [
  "Is this field showing stress?",
  "How does satellite ET compare to the model?",
  "What changed in the last two weeks?",
];

export default function FieldChat({
  range,
  index,
  engineContext,
}: {
  range: Range;
  index: string;
  engineContext: EngineContext;
}) {
  const { field } = useField();
  const { crop } = useCrop();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [unconfigured, setUnconfigured] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const cropLabel = crop ? crop.charAt(0).toUpperCase() + crop.slice(1) : null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || !field || loading) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await postChat(field.id, {
        messages: next,
        range: range ?? {},
        index,
        engine_context: engineContext ?? {},
      });
      if (res.status === "unconfigured") {
        setUnconfigured(true);
      } else if (res.status === "ok" && res.reply) {
        setMessages((m) => [...m, { role: "assistant", content: res.reply as string }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: res.message || "Sorry, I couldn't answer that right now." }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Chat is unavailable right now." }]);
    } finally {
      setLoading(false);
    }
  }

  // Collapsed launcher. Pinned bottom-right of the viewport — clear of the map's
  // top-left zoom/draw controls; the map (a top card) sits well above this.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask about this field"
        className="fixed bottom-5 right-5 z-[1000] inline-flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-medium text-canvas shadow-hero transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <MessageCircle className="h-5 w-5" />
        <span className="hidden sm:inline">Ask about this field</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[1000] flex h-[min(560px,78vh)] w-[min(94vw,400px)] flex-col overflow-hidden rounded-xl2 border border-hairline bg-card shadow-hero">
      {/* header — shows the active field + crop it's grounded on */}
      <div className="flex items-start justify-between gap-2 border-b border-hairline bg-soil-soft/30 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-water" /> Ask about this field
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted">
            {field ? (
              <>
                Asking about <span className="font-medium text-ink/75">{field.name}</span>
                {cropLabel ? <> · {cropLabel}</> : null}
              </>
            ) : (
              "No field selected"
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          className="-mr-1 shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-soil-soft/60 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!field ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
          <MapPin className="h-7 w-7" />
          <p className="max-w-[16rem]">Select a field first — draw or upload one on the map, then ask about it.</p>
        </div>
      ) : unconfigured ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
          <KeyRound className="h-7 w-7" />
          <p className="max-w-[16rem]">Add an ANTHROPIC_API_KEY on the server to enable the field chat.</p>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  Ask about <span className="font-medium text-ink/75">{field.name}</span>&apos;s health — grounded on its
                  latest numbers. Try:
                </p>
                <div className="flex flex-col gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-lg border border-hairline bg-soil-soft/20 px-3 py-2 text-left text-[13px] text-ink transition-colors hover:border-brand/40 hover:bg-soil-soft/40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)
            )}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…
              </div>
            )}
          </div>

          <div className="border-t border-hairline p-2.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex items-center gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                aria-label="Ask a question about this field"
                className="h-9 flex-1 rounded-md border border-hairline bg-card px-3 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                aria-label="Send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand text-canvas transition-opacity disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
            <div className="mt-1.5 flex items-center justify-between px-0.5">
              <span className="flex items-center gap-1 text-[10px] text-muted">
                <Info className="h-3 w-3" /> AI-generated · advisory
              </span>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMessages([])}
                  className="flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-ink"
                >
                  <Trash2 className="h-3 w-3" /> Clear chat
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-xl2 px-3 py-2 text-[13px] leading-relaxed ${
          isUser ? "bg-brand text-canvas" : "border border-hairline bg-soil-soft/25 text-ink/85"
        }`}
      >
        {content}
      </div>
    </div>
  );
}
