"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { OnChainStatus } from "@/hooks/useRequestStatus";

const STEPS = [
  { key: "PENDING", label: "Request Created" },
  { key: "EVENT_VERIFIED", label: "Event Verified" },
  { key: "APPROVED", label: "Aid Approved" },
  { key: "FULFILLED", label: "Delivered & Paid" },
] as const;

const STATUS_ORDER: Record<string, number> = {
  PENDING: 0,
  EVENT_VERIFIED: 1,
  APPROVED: 2,
  FULFILLED: 3,
};

interface Props {
  status: OnChainStatus | null;
  txHash?: string;
}

export default function OnChainProgressTracker({ status, txHash }: Props) {
  const currentIndex = status ? (STATUS_ORDER[status.status] ?? -1) : -1;

  return (
    <div className="flex items-center gap-0 w-full px-2">
      {STEPS.map((step, i) => {
        const done = currentIndex > i;
        const active = currentIndex === i;

        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0 last:flex-none">
            {/* Step node */}
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className="relative"
              >
                {done ? (
                  <CheckCircle2 className="w-4 h-4 text-success" />
                ) : active ? (
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                ) : (
                  <Circle className="w-4 h-4 text-slate-300" />
                )}
              </motion.div>
              <span
                className={`text-[9px] font-medium whitespace-nowrap ${
                  done ? "text-success" : active ? "text-primary" : "text-slate-400"
                }`}
              >
                {step.label}
              </span>
            </div>

            {/* Connecting line */}
            {i < STEPS.length - 1 && (
              <div className="flex-1 mx-1 h-px relative">
                <div className="absolute inset-0 bg-slate-200" />
                {done && (
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.5 }}
                    className="absolute inset-0 bg-success origin-left"
                  />
                )}
              </div>
            )}
          </div>
        );
      })}


    </div>
  );
}
