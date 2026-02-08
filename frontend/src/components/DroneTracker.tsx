"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navigation, MapPin, AlertTriangle, Package, CheckCircle2 } from "lucide-react";

interface DroneEvent {
  id: string;
  text: string;
  icon: "nav" | "pin" | "alert" | "package" | "check";
  time: string;
}

let globalEventId = 0;

const ICON_MAP = {
  nav: <Navigation className="w-3.5 h-3.5 text-primary" />,
  pin: <MapPin className="w-3.5 h-3.5 text-amber-500" />,
  alert: <AlertTriangle className="w-3.5 h-3.5 text-danger" />,
  package: <Package className="w-3.5 h-3.5 text-success" />,
  check: <CheckCircle2 className="w-3.5 h-3.5 text-success" />,
};

interface DroneScriptItem extends Omit<DroneEvent, "id" | "time"> {
  /** ETA in minutes to show at this step, null = keep previous */
  eta: number | null;
}

const DRONE_SCRIPT: DroneScriptItem[] = [
  { text: "Drone AEG-04 dispatched from Warehouse Alpha", icon: "nav", eta: 12 },
  { text: "Calibrating GPS & payload — 12.4kg medical kit", icon: "package", eta: 11 },
  { text: "Cruising altitude reached — 120m AGL", icon: "nav", eta: 9 },
  { text: "Approaching disaster perimeter — 2.1km out", icon: "pin", eta: 7 },
  { text: "Entering danger zone — switching to thermal scan", icon: "alert", eta: 5 },
  { text: "Heat signature detected — 3 individuals, quadrant B7", icon: "alert", eta: 4 },
  { text: "Descending to drop altitude — 15m AGL", icon: "nav", eta: 2 },
  { text: "Payload released — medical kit delivered", icon: "package", eta: 0 },
  { text: "Confirming receipt — visual contact established", icon: "check", eta: null },
  { text: "Ascending — returning to Warehouse Alpha", icon: "nav", eta: null },
];

interface DroneTrackerProps {
  /** When false the panel shows a "Standby" state. Events only stream when true. */
  active?: boolean;
  /** Change this key to reset drone operations and run a fresh cycle. */
  resetKey?: number;
}

export default function DroneTracker({ active = false, resetKey = 0 }: DroneTrackerProps) {
  const [events, setEvents] = useState<DroneEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const startedRef = useRef(false);

  // Reset state when resetKey changes (new request)
  useEffect(() => {
    setEvents([]);
    indexRef.current = 0;
    startedRef.current = false;
  }, [resetKey]);

  useEffect(() => {
    // Don't start until active, and only start once per cycle
    if (!active || startedRef.current) return;
    startedRef.current = true;

    const addEvent = () => {
      // Stop after one full cycle — don't loop
      if (indexRef.current >= DRONE_SCRIPT.length) return;

      const scriptItem = DRONE_SCRIPT[indexRef.current];
      const now = new Date();
      const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

      const eventId = `drone-${globalEventId++}`;
      indexRef.current++;

      // Broadcast ETA update to Dashboard
      if (scriptItem.eta !== null && scriptItem.eta !== undefined) {
        window.dispatchEvent(
          new CustomEvent("aegis-drone-eta", { detail: { eta: scriptItem.eta } })
        );
      }

      setEvents((prev) => {
        // Deduplicate in case React calls the updater twice
        if (prev.some((e) => e.id === eventId)) return prev;
        const next = [...prev, { ...scriptItem, id: eventId, time }];
        return next.slice(-30); // keep last 30
      });

      // Stop interval after last event
      if (indexRef.current >= DRONE_SCRIPT.length) {
        clearInterval(intervalId);
      }
    };

    // First event immediately
    addEvent();
    const intervalId = setInterval(addEvent, 4000 + Math.random() * 2000);
    return () => clearInterval(intervalId);
  }, [active, resetKey]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Navigation className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-slate-900">Drone Operations</h3>
        {active ? (
          <span className="ml-auto text-[10px] font-medium text-success flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            LIVE
          </span>
        ) : (
          <span className="ml-auto text-[10px] font-medium text-muted flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
            STANDBY
          </span>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {!active && events.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <Navigation className="w-6 h-6 text-slate-300" />
            <p className="text-xs text-muted">Awaiting aid approval...</p>
            <p className="text-[10px] text-slate-300">Drone operations will begin once aid is approved on-chain.</p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {events.map((ev) => (
            <motion.div
              key={ev.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="flex items-start gap-2.5"
            >
              <div className="shrink-0 mt-0.5">{ICON_MAP[ev.icon]}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-700 leading-relaxed">{ev.text}</p>
              </div>
              <span className="shrink-0 text-[10px] text-slate-300 font-mono mt-0.5">{ev.time}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}