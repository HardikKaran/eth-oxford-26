"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Clock, CheckCircle2, Loader2, Camera, ExternalLink, MapPin } from "lucide-react";

interface VerificationCard {
  id: string;
  droneId: string;
  timestamp: string;
  location: string;
  imageUrl: string;
  status: "capturing" | "verifying" | "verified";
  txHash?: string;
}

const INITIAL_CARDS: VerificationCard[] = [
  {
    id: "v1",
    droneId: "D-07",
    timestamp: "14:23:45 UTC",
    location: "34.0522°N, 118.2437°W",
    imageUrl: "https://images.unsplash.com/photo-1547683905-f686c993aae5?w=400&h=300&fit=crop&auto=format",
    status: "verified",
    txHash: "0x7a3f...c821",
  },
  {
    id: "v2",
    droneId: "D-12",
    timestamp: "14:24:12 UTC",
    location: "34.0530°N, 118.2441°W",
    imageUrl: "https://images.unsplash.com/photo-1504701954957-2010ec3bcec1?w=400&h=300&fit=crop&auto=format",
    status: "verified",
    txHash: "0x9b2e...a134",
  },
  {
    id: "v3",
    droneId: "D-03",
    timestamp: "14:25:03 UTC",
    location: "34.0515°N, 118.2455°W",
    imageUrl: "https://images.unsplash.com/photo-1542281286-9e0a16bb7366?w=400&h=300&fit=crop&auto=format",
    status: "verifying",
  },
];

const NEW_CARDS: Omit<VerificationCard, "id">[] = [
  {
    droneId: "D-07",
    timestamp: "14:26:31 UTC",
    location: "34.0528°N, 118.2462°W",
    imageUrl: "https://images.unsplash.com/photo-1527482797697-8795b05a13fe?w=400&h=300&fit=crop&auto=format",
    status: "capturing",
  },
  {
    droneId: "D-12",
    timestamp: "14:27:15 UTC",
    location: "34.0541°N, 118.2439°W",
    imageUrl: "https://images.unsplash.com/photo-1569242840510-9fe6f0112cee?w=400&h=300&fit=crop&auto=format",
    status: "capturing",
  },
];

export default function VerificationFeed() {
  const [cards, setCards] = useState<VerificationCard[]>(INITIAL_CARDS);

  // Simulate status progression
  useEffect(() => {
    const interval = setInterval(() => {
      setCards((prev) =>
        prev.map((card) => {
          if (card.status === "capturing") return { ...card, status: "verifying" as const };
          if (card.status === "verifying")
            return {
              ...card,
              status: "verified" as const,
              txHash: `0x${Math.random().toString(16).slice(2, 6)}...${Math.random().toString(16).slice(2, 6)}`,
            };
          return card;
        })
      );
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Stream new cards
  useEffect(() => {
    let idx = 0;
    const interval = setInterval(() => {
      if (idx < NEW_CARDS.length) {
        const newCard: VerificationCard = { ...NEW_CARDS[idx], id: `v-${Date.now()}` };
        setCards((prev) => [newCard, ...prev.slice(0, 6)]);
        idx++;
      }
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-full bg-card rounded-3xl border border-border shadow-lg shadow-slate-200/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-slate-900">Drone Verification</h3>
        <span className="text-[11px] text-muted font-medium">
          {cards.filter((c) => c.status === "verified").length}/{cards.length} verified
        </span>
      </div>

      {/* Cards list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence initial={false}>
          {cards.map((card) => (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: -15, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.4 }}
              layout
            >
              <PolaroidCard card={card} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function PolaroidCard({ card }: { card: VerificationCard }) {
  const statusConfig = {
    capturing: {
      icon: <Camera className="w-3.5 h-3.5 animate-pulse" />,
      label: "Capturing...",
      color: "text-amber-500",
      dot: "bg-amber-400",
    },
    verifying: {
      icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      label: "Verifying on Flare...",
      color: "text-amber-500",
      dot: "bg-amber-400",
    },
    verified: {
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      label: "Verified",
      color: "text-success",
      dot: "bg-success",
    },
  }[card.status];

  return (
    <div className="bg-white rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Photo — Polaroid style */}
      <div className="relative aspect-4/3 overflow-hidden bg-slate-100">
        <img
          src={card.imageUrl}
          alt={`Drone ${card.droneId} capture`}
          className="w-full h-full object-cover grayscale-30 hover:grayscale-0 transition-all duration-500"
        />
        {/* Overlay badge */}
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-linear-to-t bg-white/90 backdrop-blur-sm border border-white/50 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-700">
            {card.droneId}
          </span>
        </div>
      </div>

      {/* Info — like a Polaroid caption */}
      <div className="p-4 space-y-2.5">
        {/* Location & time */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-muted">
            <MapPin className="w-3 h-3" />
            {card.location}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted">
            <Clock className="w-3 h-3" />
            {card.timestamp}
          </span>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-1.5 ${statusConfig.color}`}>
            {statusConfig.icon}
            <span className="text-xs font-medium">{statusConfig.label}</span>
          </div>
          {card.txHash && (
            <a href="#" className="flex items-center gap-1 text-[11px] text-muted hover:text-primary transition-colors font-mono">
              {card.txHash}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
