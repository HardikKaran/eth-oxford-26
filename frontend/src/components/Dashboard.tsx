"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  ArrowLeft,
  CheckCircle2,
  MessageSquarePlus,
  X,
  Send,
  Clock,
} from "lucide-react";
import GoogleMapComponent from "./GoogleMapComponent";
import DroneTracker from "./DroneTracker";
import AgentDebatePanel from "./AgentDebatePanel";
import type { Disaster, EvaluationResult, UserLocation } from "@/lib/types";

interface DashboardProps {
  userMessage: string;
  userLocation: UserLocation | null;
  disaster: Disaster | null;
  evaluationResult: EvaluationResult | null;
  onBack: () => void;
}

export default function Dashboard({
  userMessage,
  userLocation,
  disaster,
  evaluationResult,
  onBack,
}: DashboardProps) {
  const mapCenter = userLocation ?? { lat: 51.752, lng: -1.2577 };
  const disasterZone = disaster
    ? { lat: disaster.lat, lng: disaster.lon, radius: disaster.radius * 1000 }
    : { lat: mapCenter.lat, lng: mapCenter.lng - 0.002, radius: 800 };

  // --- Drone ETA ---
  const [droneEta, setDroneEta] = useState<number | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const eta = (e as CustomEvent).detail?.eta;
      if (typeof eta === "number") setDroneEta(eta);
    };
    window.addEventListener("aegis-drone-eta", handler);
    return () => window.removeEventListener("aegis-drone-eta", handler);
  }, []);

  // --- Show aid recommendation only after debate completes ---
  const [showRecommendation, setShowRecommendation] = useState(false);
  // --- Drone starts after debate completes, not from chain status ---
  const [debateComplete, setDebateComplete] = useState(false);
  // --- Key to reset drone tracker on each new debate conclusion ---
  const [droneResetKey, setDroneResetKey] = useState(0);
  useEffect(() => {
    const handler = () => {
      setShowRecommendation(true);
      setDebateComplete(true);
      setDroneResetKey((k) => k + 1);
      setDroneEta(null);
    };
    window.addEventListener("aegis-debate-complete", handler);
    return () => window.removeEventListener("aegis-debate-complete", handler);
  }, []);

  // --- Track latest request message & aid recommendation (updated on new requests) ---
  const [latestMessage, setLatestMessage] = useState(userMessage);
  const [latestAidRec, setLatestAidRec] = useState(evaluationResult?.aid_recommendation || "");
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.description) setLatestMessage(detail.description);
      // Only update aid recommendation when a non-empty value arrives
      // This prevents it from disappearing while the LLM is still generating
      if (detail?.aid_recommendation) {
        setLatestAidRec(detail.aid_recommendation);
      }
    };
    window.addEventListener("aegis-evaluation-result", handler);
    return () => window.removeEventListener("aegis-evaluation-result", handler);
  }, []);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");

  // Drone operations only start after agent swarm reaches a conclusion
  const droneActive = debateComplete;

  const handleChatSubmit = () => {
    if (chatMessage.trim().length === 0) return;
    // Update latest message immediately
    setLatestMessage(chatMessage);
    // Dispatch event that AgentDebatePanel listens for
    window.dispatchEvent(
      new CustomEvent("aegis-new-request", { detail: { description: chatMessage } })
    );
    setChatMessage("");
    setChatOpen(false);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* ========== HEADER ========== */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="text-base font-semibold text-slate-900">Aegis</span>
            {evaluationResult?.on_chain && evaluationResult.request_id != null && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/5 border border-primary/15 text-[9px] font-bold text-primary">
                Request #{evaluationResult.request_id}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setChatOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary bg-primary/5 border border-primary/15 hover:bg-primary/10 transition-colors"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            Request Additional Aid
          </button>

          <div className="flex items-center gap-1.5 text-xs font-medium">
          {droneActive && droneEta !== null ? (
            <>
              <Clock className="w-3.5 h-3.5 text-primary" />
              <span className={droneEta === 0 ? "text-success" : "text-primary"}>
                {droneEta === 0 ? "Drone Arrived" : `Drone ETA: ${droneEta} min`}
              </span>
              {droneEta > 0 && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
            </>
          ) : droneActive ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span className="text-success">Drone Dispatched</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-600">Awaiting Approval</span>
            </>
          )}
          </div>
        </div>
      </header>

      {/* ========== LATEST RELIEF + INFO BAR ========== */}
      {latestMessage && (
        <div className="flex items-center justify-center gap-2 px-6 py-2.5 border-b border-border bg-primary/5 shrink-0">
          <Shield className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-[11px] font-medium text-primary">Latest Relief Request:</span>
          <span className="text-[11px] text-slate-700 truncate max-w-xl">{latestMessage}</span>
        </div>
      )}

      {/* ========== AID RECOMMENDATION ========== */}
      {showRecommendation && latestAidRec && (
        <div className="flex items-center justify-center gap-2 px-6 py-2 border-b border-border bg-success/5 shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
          <span className="text-[11px] font-medium text-success">Aid Dispatched:</span>
          <span className="text-[11px] text-slate-700 truncate max-w-2xl">{latestAidRec}</span>
        </div>
      )}

      {/* ========== MAIN CONTENT ========== */}
      <main className="flex-1 flex overflow-hidden p-4 gap-4">
        {/* LEFT — Map (half width) */}
        <div className="w-1/2 shrink-0">
          <GoogleMapComponent
            userLocation={mapCenter}
            disasterZone={disasterZone}
            className="h-full"
          />
        </div>

        {/* RIGHT — Two stacked panels */}
        <div className="w-1/2 flex flex-col gap-4 min-h-0">
          {/* Top — Drone Tracker */}
          <div className="flex-1 min-h-0 rounded-2xl border border-border bg-card overflow-hidden">
             <DroneTracker active={droneActive} resetKey={droneResetKey} />
          </div>

          {/* Bottom — Agent Debate */}
          <div className="flex-1 min-h-0 rounded-2xl border border-border bg-card overflow-hidden">
            <AgentDebatePanel
              disaster={disaster}
              userLocation={userLocation}
              initialEvaluation={evaluationResult}
              initialMessage={userMessage}
            />
          </div>
        </div>
      </main>

      {/* ========== FLOATING CHAT MODAL ========== */}
      <AnimatePresence>
        {chatOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setChatOpen(false)}
              className="fixed inset-0 bg-black/20 z-40"
            />
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="fixed bottom-6 right-6 w-95 z-50 rounded-2xl bg-white border border-border shadow-2xl shadow-black/10 overflow-hidden"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-slate-900">Request More Help</span>
                </div>
                <button
                  onClick={() => setChatOpen(false)}
                  className="text-muted hover:text-slate-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Disaster context */}
              {disaster && (
                <div className="px-5 pt-3">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-danger/5 border border-danger/15 text-[10px] font-medium text-danger">
                    {disaster.name}
                  </span>
                </div>
              )}

              {/* Input */}
              <div className="p-5 space-y-3">
                <textarea
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  placeholder="Describe what additional aid you need..."
                  rows={3}
                  className="w-full resize-none rounded-xl bg-surface border border-border px-4 py-3 text-sm text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleChatSubmit();
                    }
                  }}
                />

                {/* Quick suggestions */}
                <div className="flex flex-wrap gap-1.5">
                  {["Need more water", "Medical evacuation", "Structural rescue"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setChatMessage(s)}
                      className="px-3 py-1.5 rounded-full text-[10px] font-medium bg-surface border border-border text-muted hover:text-slate-700 hover:border-slate-300 transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleChatSubmit}
                  disabled={chatMessage.trim().length === 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" />
                  Submit Request
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
