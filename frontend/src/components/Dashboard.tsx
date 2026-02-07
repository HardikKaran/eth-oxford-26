"use client";

import { motion } from "framer-motion";
import { Shield, ArrowLeft, Navigation, DollarSign, Heart, BatteryMedium } from "lucide-react";
import GoogleMapComponent from "./GoogleMapComponent";
import ActivityFeed from "./ActivityFeed";
import VerificationFeed from "./VerificationFeed";

interface DashboardProps {
  userMessage: string;
  onBack: () => void;
}

const USER_LOCATION = { lat: 51.752, lng: -1.2577 }; // Oxford
const DISASTER_ZONE = { lat: 51.749, lng: -1.26, radius: 800 };

const STATS = [
  { label: "Active Drones", value: "12", icon: <Navigation className="w-4 h-4" />, color: "text-primary" },
  { label: "Funds Deployed", value: "4,500 FLR", icon: <DollarSign className="w-4 h-4" />, color: "text-amber-500" },
  { label: "Lives Aided", value: "34", icon: <Heart className="w-4 h-4" />, color: "text-danger" },
  { label: "Fleet Battery", value: "82%", icon: <BatteryMedium className="w-4 h-4" />, color: "text-success" },
];

export default function Dashboard({ userMessage, onBack }: DashboardProps) {
  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
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
          </div>
        </div>

        {/* User request summary */}
        <div className="hidden md:flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface border border-border">
          <span className="text-xs text-muted">Request:</span>
          <span className="text-xs font-medium text-slate-700 max-w-xs truncate">
            &ldquo;{userMessage}&rdquo;
          </span>
        </div>

        {/* Status */}
        <div className="flex items-center gap-1.5 text-xs font-medium text-success">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          Mission Active
        </div>
      </header>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
        {STATS.map((stat) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 px-5 py-3 bg-card"
          >
            <div className={`${stat.color}`}>{stat.icon}</div>
            <div>
              <p className="text-lg font-bold text-slate-900 font-mono">{stat.value}</p>
              <p className="text-[11px] text-muted">{stat.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Content Grid */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_minmax(320px,380px)] gap-0 overflow-hidden">
        {/* Left — Map + Activity stacked */}
        <div className="flex flex-col overflow-hidden border-r border-border">
          {/* Map */}
          <div className="h-[55%] p-4 pb-2">
            <GoogleMapComponent
              userLocation={USER_LOCATION}
              disasterZone={DISASTER_ZONE}
              className="h-full"
            />
          </div>
          {/* Activity Feed */}
          <div className="flex-1 min-h-0 p-4 pt-2">
            <ActivityFeed />
          </div>
        </div>

        {/* Right — Verification Feed */}
        <div className="min-h-0 overflow-hidden p-4">
          <VerificationFeed />
        </div>
      </main>
    </div>
  );
}
