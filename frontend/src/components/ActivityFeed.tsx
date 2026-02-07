"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  Navigation,
  Package,
  Cpu,
  CircleDollarSign,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Zap,
} from "lucide-react";

interface ActivityItem {
  id: number;
  agent: string;
  message: string;
  type: "info" | "warning" | "success" | "error";
  timestamp: string;
}

const AGENT_ICONS: Record<string, React.ReactNode> = {
  ORACLE: <Radio className="w-4 h-4" />,
  SCOUT: <Zap className="w-4 h-4" />,
  TREASURY: <CircleDollarSign className="w-4 h-4" />,
  SWARM: <Navigation className="w-4 h-4" />,
  LOGISTICS: <Package className="w-4 h-4" />,
  SYSTEM: <Cpu className="w-4 h-4" />,
};

const AGENT_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  ORACLE: { bg: "bg-orange-50", text: "text-orange-600", icon: "text-orange-500" },
  SCOUT: { bg: "bg-blue-50", text: "text-blue-600", icon: "text-blue-500" },
  TREASURY: { bg: "bg-amber-50", text: "text-amber-600", icon: "text-amber-500" },
  SWARM: { bg: "bg-emerald-50", text: "text-emerald-600", icon: "text-emerald-500" },
  LOGISTICS: { bg: "bg-violet-50", text: "text-violet-600", icon: "text-violet-500" },
  SYSTEM: { bg: "bg-slate-50", text: "text-slate-600", icon: "text-slate-500" },
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle2 className="w-3.5 h-3.5 text-success" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
  error: <AlertTriangle className="w-3.5 h-3.5 text-danger" />,
  info: null,
};

const INITIAL_ACTIVITIES: ActivityItem[] = [
  { id: 1, agent: "SYSTEM", message: "Aegis initialized. Monitoring active.", type: "info", timestamp: "14:23:01" },
  { id: 2, agent: "ORACLE", message: "Flare FDC connected — attestations streaming.", type: "success", timestamp: "14:23:03" },
  { id: 3, agent: "SCOUT", message: "USGS Event #9921 — Magnitude 6.2 detected.", type: "warning", timestamp: "14:23:08" },
  { id: 4, agent: "TREASURY", message: "4,500 FLR allocated to relief operation.", type: "success", timestamp: "14:23:12" },
  { id: 5, agent: "SWARM", message: "3 drones assigned. Routes optimized.", type: "info", timestamp: "14:23:15" },
  { id: 6, agent: "LOGISTICS", message: "Drone D-07 dispatched to Drop Zone Alpha.", type: "success", timestamp: "14:23:22" },
  { id: 7, agent: "LOGISTICS", message: "Drone D-12 dispatched to Drop Zone Bravo.", type: "success", timestamp: "14:23:23" },
];

const STREAM_EVENTS: Omit<ActivityItem, "id" | "timestamp">[] = [
  { agent: "ORACLE", message: "Aftershock detected: Magnitude 3.1", type: "warning" },
  { agent: "LOGISTICS", message: "D-07 reached waypoint 2 of 4. Altitude 120m.", type: "info" },
  { agent: "TREASURY", message: "Gas optimized — Tx confirmed at 25 gwei.", type: "info" },
  { agent: "SWARM", message: "D-12 entering drop zone corridor.", type: "info" },
  { agent: "ORACLE", message: "On-chain verification complete. Block #1,429,881.", type: "success" },
  { agent: "SWARM", message: "D-07 payload delivered at Zone Alpha.", type: "success" },
  { agent: "SCOUT", message: "Survivor cluster detected: ~40 individuals.", type: "warning" },
  { agent: "LOGISTICS", message: "D-12 drop complete. Returning to base.", type: "success" },
  { agent: "TREASURY", message: "DAO vote passed — emergency funds released.", type: "success" },
  { agent: "ORACLE", message: "Landslide risk elevated in Sector 7-B.", type: "error" },
];

function getTimestamp(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
}

export default function ActivityFeed() {
  const [activities, setActivities] = useState<ActivityItem[]>(INITIAL_ACTIVITIES);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamIdx = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const next = STREAM_EVENTS[streamIdx.current % STREAM_EVENTS.length];
      setActivities((prev) => [
        ...prev.slice(-20),
        { ...next, id: Date.now(), timestamp: getTimestamp() },
      ]);
      streamIdx.current++;
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [activities]);

  return (
    <div className="flex flex-col h-full bg-card rounded-3xl border border-border shadow-lg shadow-slate-200/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-slate-900">Activity</h3>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-success">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          Live
        </span>
      </div>

      {/* Activity list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <AnimatePresence initial={false}>
          {activities.map((item) => {
            const colors = AGENT_COLORS[item.agent] || AGENT_COLORS.SYSTEM;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="flex items-start gap-3 px-5 py-3.5 border-b border-border/50 last:border-0 hover:bg-surface/50 transition-colors"
              >
                {/* Agent icon */}
                <div className={`mt-0.5 w-8 h-8 rounded-xl ${colors.bg} flex items-center justify-center shrink-0`}>
                  <span className={colors.icon}>
                    {AGENT_ICONS[item.agent] || AGENT_ICONS.SYSTEM}
                  </span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-xs font-semibold ${colors.text}`}>
                      {item.agent}
                    </span>
                    {TYPE_ICON[item.type]}
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    {item.message}
                  </p>
                </div>

                {/* Timestamp */}
                <span className="text-[11px] text-muted font-mono shrink-0 mt-1">
                  {item.timestamp}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
