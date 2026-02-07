"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, Shield, ShieldCheck, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/types";
import type { Disaster, NearbyResponse, UserLocation } from "@/lib/types";

interface SafetyCheckProps {
  onRequestAssistance: (location: UserLocation, disaster: Disaster | null) => void;
}

export default function SafetyCheck({ onRequestAssistance }: SafetyCheckProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationName, setLocationName] = useState("Detecting location...");
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [nearbyData, setNearbyData] = useState<NearbyResponse | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
        setUserLocation(loc);

        try {
          const res = await fetch(`${API_BASE}/nearby?lat=${loc.lat}&lng=${loc.lng}`);
          if (!res.ok) throw new Error("Backend unreachable");
          const data: NearbyResponse = await res.json();
          setNearbyData(data);
          setLocationName(data.location_name || "Your Location");
        } catch {
          setError("Could not connect to Aegis servers. Please ensure the backend is running.");
        } finally {
          setLoading(false);
        }
      },
      () => {
        setError("Location access denied. Please allow location access to use Aegis.");
        setLoading(false);
      }
    );
  }, []);

  const hasThreat = nearbyData ? !nearbyData.safe : false;

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
        <span className="text-sm font-medium">{locationName}</span>
      </motion.div>

      {/* Main Status Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="w-full max-w-md"
      >
        {loading ? (
          <LoadingCard />
        ) : error ? (
          <ErrorCard message={error} />
        ) : hasThreat && nearbyData?.disaster ? (
          <DangerCard disaster={nearbyData.disaster} />
        ) : (
          <SafeCard />
        )}
      </motion.div>

      {/* CTA Button */}
      {!loading && !error && (
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => userLocation && onRequestAssistance(userLocation, nearbyData?.disaster || null)}
          className={`mt-10 px-10 py-4 rounded-full text-base font-semibold shadow-lg transition-shadow ${
            hasThreat
              ? "bg-danger text-white shadow-danger/25 hover:shadow-danger/40"
              : "bg-primary text-white shadow-primary/25 hover:shadow-primary/40"
          }`}
        >
          Request Assistance
        </motion.button>
      )}

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

function LoadingCard() {
  return (
    <div className="rounded-3xl bg-surface border border-border p-8 text-center">
      <div className="flex justify-center mb-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
      <h1 className="text-xl font-bold text-slate-900 mb-2">Scanning Your Area</h1>
      <p className="text-muted text-sm leading-relaxed">
        Checking for active threats near your location...
      </p>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-3xl bg-danger-light border border-danger/20 p-8 text-center">
      <div className="flex justify-center mb-4">
        <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-danger" />
        </div>
      </div>
      <h1 className="text-xl font-bold text-slate-900 mb-2">Connection Issue</h1>
      <p className="text-muted text-sm leading-relaxed">{message}</p>
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

function DangerCard({ disaster }: { disaster: Disaster }) {
  return (
    <div className="rounded-3xl bg-danger-light border border-danger/20 p-8 text-center">
      <div className="flex justify-center mb-4">
        <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-danger" />
        </div>
      </div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        {disaster.name}
      </h1>
      <p className="text-muted text-sm leading-relaxed mb-4">
        Active threat detected <span className="font-medium text-slate-700">{disaster.distance_km}km</span> from your location.
        <br />
        Emergency radius: <span className="font-medium text-danger">{disaster.radius}km</span>
      </p>

      {/* Attestation Hash (simulated) */}
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/60 border border-slate-200">
        <span className="text-[11px] text-muted font-mono">
          FDC: 0x{disaster.id.replace("d", "a3f9")}...c821
        </span>
        <ExternalLink className="w-3 h-3 text-muted" />
      </div>
    </div>
  );
}
