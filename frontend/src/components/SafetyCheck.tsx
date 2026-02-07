"use client";

import { motion } from "framer-motion";
import { MapPin, Shield, ShieldCheck, AlertTriangle, ExternalLink } from "lucide-react";

interface SafetyCheckProps {
  onRequestAssistance: () => void;
}

// Mock data — in production, this comes from Flare FDC
const MOCK_THREAT = {
  active: true,
  type: "Wildfire Warning",
  source: "Flare FDC / USGS",
  attestationHash: "0x7a3f9b2e...c821d4a1",
  region: "Sector 7 — Northern Corridor",
  severity: "High",
};

const LOCATION = "Oxford, UK";

export default function SafetyCheck({ onRequestAssistance }: SafetyCheckProps) {
  const hasThreat = MOCK_THREAT.active;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 py-12">
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="flex items-center gap-2.5 mb-16"
      >
        <Shield className="w-7 h-7 text-primary" />
        <span className="text-xl font-semibold tracking-wide text-slate-900">
          Aegis
        </span>
      </motion.div>

      {/* Location */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="flex items-center gap-2 text-muted mb-3"
      >
        <MapPin className="w-4 h-4" />
        <span className="text-sm font-medium">{LOCATION}</span>
      </motion.div>

      {/* Main Status Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="w-full max-w-md"
      >
        {hasThreat ? <DangerCard /> : <SafeCard />}
      </motion.div>

      {/* CTA Button */}
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onRequestAssistance}
        className={`mt-10 px-10 py-4 rounded-full text-base font-semibold shadow-lg transition-shadow ${
          hasThreat
            ? "bg-danger text-white shadow-danger/25 hover:shadow-danger/40"
            : "bg-primary text-white shadow-primary/25 hover:shadow-primary/40"
        }`}
      >
        Request Assistance
      </motion.button>

      {/* Subtle footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="mt-6 text-xs text-muted"
      >
        Powered by Flare Network • AI-Verified Data
      </motion.p>
    </div>
  );
}

function SafeCard() {
  return (
    <div className="rounded-3xl bg-success-light border border-success/20 p-8 text-center">
      <div className="flex justify-center mb-4">
        <div className="w-14 h-14 rounded-2xl bg-success/10 flex items-center justify-center">
          <ShieldCheck className="w-7 h-7 text-success" />
        </div>
      </div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">You&apos;re Safe</h1>
      <p className="text-muted text-sm leading-relaxed">
        No active threats detected in your area.
        <br />
        Verified by Flare FDC attestation.
      </p>
    </div>
  );
}

function DangerCard() {
  return (
    <div className="rounded-3xl bg-danger-light border border-danger/20 p-8 text-center">
      <div className="flex justify-center mb-4">
        <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-danger" />
        </div>
      </div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        {MOCK_THREAT.type}
      </h1>
      <p className="text-muted text-sm leading-relaxed mb-4">
        Active threat detected in <span className="font-medium text-slate-700">{MOCK_THREAT.region}</span>.
        <br />
        Severity: <span className="font-medium text-danger">{MOCK_THREAT.severity}</span>
      </p>

      {/* Attestation Hash */}
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/60 border border-slate-200">
        <span className="text-[11px] text-muted font-mono">
          FDC: {MOCK_THREAT.attestationHash}
        </span>
        <ExternalLink className="w-3 h-3 text-muted" />
      </div>
    </div>
  );
}
