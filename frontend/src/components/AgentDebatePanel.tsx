"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Gavel, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/types";
import type { Disaster, EvaluationResult, UserLocation } from "@/lib/types";

interface DebateMessage {
  id: number;
  agent: string;
  text: string;
  type: "comment" | "verdict";
}

interface AgentDebatePanelProps {
  disaster: Disaster | null;
  userLocation: UserLocation | null;
  /** Initial evaluation from the first request — replayed with delays */
  initialEvaluation: EvaluationResult | null;
  initialMessage: string;
}

const DELAY_MS = 3000; // 3 seconds between each agent message

export default function AgentDebatePanel({
  disaster,
  userLocation,
  initialEvaluation,
  initialMessage,
}: AgentDebatePanelProps) {
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [isDebating, setIsDebating] = useState(false);
  const [currentVerdict, setCurrentVerdict] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Replay initial evaluation with 3-second delays
  useEffect(() => {
    if (!initialEvaluation?.debate?.length) return;

    setIsDebating(true);
    const debate = initialEvaluation.debate;
    let i = 0;

    const interval = setInterval(() => {
      if (i >= debate.length) {
        clearInterval(interval);
        // Show verdict
        if (initialEvaluation.final_verdict) {
          const vid = msgIdRef.current++;
          setMessages((prev) => [
            ...prev,
            { id: vid, agent: "The Arbiter", text: initialEvaluation.final_verdict!, type: "verdict" },
          ]);
          setCurrentVerdict(initialEvaluation.final_verdict);
        }
        setIsDebating(false);
        // Signal that debate is complete so Dashboard can show aid recommendation
        window.dispatchEvent(new CustomEvent("aegis-debate-complete"));
        return;
      }

      const msg = debate[i];
      const colonIdx = msg.indexOf(":");
      const agent = colonIdx > 0 ? msg.slice(0, colonIdx).trim() : "Agent";
      const text = colonIdx > 0 ? msg.slice(colonIdx + 1).trim() : msg;

      const id = msgIdRef.current++;
      setMessages((prev) => [...prev, { id, agent, text, type: "comment" }]);
      i++;
    }, DELAY_MS);

    return () => clearInterval(interval);
  }, [initialEvaluation]);

  /** Trigger a new evaluation — called when user submits another request */
  const submitNewRequest = useCallback(
    async (description: string) => {
      if (!userLocation) return;

      setIsDebating(true);
      setCurrentVerdict(null);

      // Add a separator
      const sepId = msgIdRef.current++;
      setMessages((prev) => [
        ...prev,
        { id: sepId, agent: "System", text: `New request: "${description}"`, type: "comment" },
      ]);

      const disasterName = disaster?.name || "Unknown Disaster";
      const context = `Disaster: ${disasterName}. Aid Type: ${description.split(".")[0].slice(0, 50)}`;

      try {
        // Try SSE stream first
        const url = new URL(`${API_BASE}/evaluate-stream`);
        url.searchParams.set("request_text", description);
        url.searchParams.set("context", context);

        const eventSource = new EventSource(url.toString());
        const buffer: string[] = [];
        let displayIndex = 0;

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "comment") {
              buffer.push(data.text);
            } else if (data.type === "verdict") {
              buffer.push(`__VERDICT__${data.text}`);
              eventSource.close();
            }
          } catch {
            /* skip */
          }
        };

        eventSource.onerror = () => {
          eventSource.close();
          // Fallback to POST
          fallbackRequest(description);
        };

        // Drain buffer with 3s delays
        const drainInterval = setInterval(() => {
          if (displayIndex < buffer.length) {
            const raw = buffer[displayIndex];
            if (raw.startsWith("__VERDICT__")) {
              const v = raw.replace("__VERDICT__", "");
              const vid = msgIdRef.current++;
              setMessages((prev) => [...prev, { id: vid, agent: "The Arbiter", text: v, type: "verdict" }]);
              setCurrentVerdict(v);
              setIsDebating(false);
              clearInterval(drainInterval);
            } else {
              const colonIdx = raw.indexOf(":");
              const agent = colonIdx > 0 ? raw.slice(0, colonIdx).trim() : "Agent";
              const text = colonIdx > 0 ? raw.slice(colonIdx + 1).trim() : raw;
              const id = msgIdRef.current++;
              setMessages((prev) => [...prev, { id, agent, text, type: "comment" }]);
            }
            displayIndex++;
          }
        }, DELAY_MS);
      } catch {
        fallbackRequest(description);
      }
    },
    [disaster, userLocation]
  );

  const fallbackRequest = async (description: string) => {
    try {
      const res = await fetch(`${API_BASE}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disaster_id: disaster?.id || "demo-001",
          description,
          lat: userLocation!.lat,
          lng: userLocation!.lng,
        }),
      });

      if (!res.ok) throw new Error("Failed");
      const result: EvaluationResult = await res.json();

      // Replay with delays
      const debate = result.debate || [];
      let i = 0;
      const interval = setInterval(() => {
        if (i >= debate.length) {
          clearInterval(interval);
          if (result.final_verdict) {
            const vid = msgIdRef.current++;
            setMessages((prev) => [
              ...prev,
              { id: vid, agent: "The Arbiter", text: result.final_verdict!, type: "verdict" },
            ]);
            setCurrentVerdict(result.final_verdict);
          }
          setIsDebating(false);
          return;
        }
        const msg = debate[i];
        const colonIdx = msg.indexOf(":");
        const agent = colonIdx > 0 ? msg.slice(0, colonIdx).trim() : "Agent";
        const text = colonIdx > 0 ? msg.slice(colonIdx + 1).trim() : msg;
        const id = msgIdRef.current++;
        setMessages((prev) => [...prev, { id, agent, text, type: "comment" }]);
        i++;
      }, DELAY_MS);
    } catch {
      const eid = msgIdRef.current++;
      setMessages((prev) => [
        ...prev,
        { id: eid, agent: "System", text: "Connection failed. Retrying...", type: "comment" },
      ]);
      setIsDebating(false);
    }
  };

  return (
    <div className="flex flex-col h-full" data-debate-panel>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Bot className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-slate-900">Agent Swarm</h3>
        {currentVerdict && (
          <span
            className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${
              currentVerdict.includes("DECLINED")
                ? "bg-danger/10 text-danger"
                : "bg-success/10 text-success"
            }`}
          >
            {currentVerdict.includes("DECLINED") ? "DECLINED" : "VALID"}
          </span>
        )}
        {isDebating && !currentVerdict && (
          <Loader2 className="ml-auto w-3.5 h-3.5 text-primary animate-spin" />
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        <AnimatePresence initial={false}>
          {messages.map((msg) =>
            msg.type === "verdict" ? (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
                  msg.text.includes("DECLINED")
                    ? "bg-danger/10 border-danger/20"
                    : "bg-success/10 border-success/20"
                }`}
              >
                <Gavel className={`w-4 h-4 shrink-0 ${
                  msg.text.includes("DECLINED") ? "text-danger" : "text-success"
                }`} />
                <div>
                  <p className={`text-[10px] font-semibold ${
                    msg.text.includes("DECLINED") ? "text-danger" : "text-success"
                  }`}>Verdict</p>
                  <p className={`text-xs font-bold ${
                    msg.text.includes("DECLINED") ? "text-danger" : "text-success"
                  }`}>{msg.text.includes("DECLINED") ? "DECLINED" : "VALID"}</p>
                </div>
              </motion.div>
            ) : msg.agent === "System" ? (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-2 border-t border-border"
              >
                <span className="text-[10px] text-muted">{msg.text}</span>
              </motion.div>
            ) : (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="flex gap-2.5"
              >
                <div className="shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-primary mb-0.5">{msg.agent}</p>
                  <p className="text-xs text-slate-700 leading-relaxed">{msg.text}</p>
                </div>
              </motion.div>
            )
          )}
        </AnimatePresence>

        {isDebating && (
          <div className="flex items-center gap-2 pt-1">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="text-[10px] text-muted">Agents deliberating...</span>
          </div>
        )}
      </div>

      {/* Expose submitNewRequest via ref-like pattern using a hidden callback */}
      <SubmitBridge submitFn={submitNewRequest} />
    </div>
  );
}

/** Bridge component to expose submitNewRequest to parent via DOM event */
function SubmitBridge({ submitFn }: { submitFn: (desc: string) => Promise<void> }) {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.description) {
        submitFn(detail.description);
      }
    };
    window.addEventListener("aegis-new-request", handler);
    return () => window.removeEventListener("aegis-new-request", handler);
  }, [submitFn]);
  return null;
}
