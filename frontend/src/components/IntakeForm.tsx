"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Sparkles, Send } from "lucide-react";

interface IntakeFormProps {
  onSubmit: (message: string) => void;
  onBack: () => void;
}

export default function IntakeForm({ onSubmit, onBack }: IntakeFormProps) {
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Subtle AI indicator when user types
  useEffect(() => {
    if (message.length > 10) {
      setIsProcessing(true);
      const timeout = setTimeout(() => setIsProcessing(false), 1200);
      return () => clearTimeout(timeout);
    } else {
      setIsProcessing(false);
    }
  }, [message]);

  const handleSubmit = () => {
    if (message.trim().length === 0) return;
    onSubmit(message);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 py-12">
      {/* Back button */}
      <motion.button
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={onBack}
        className="absolute top-8 left-8 flex items-center gap-1.5 text-sm text-muted hover:text-slate-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </motion.button>

      {/* Question */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-10"
      >
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          What is the situation?
        </h1>
        <p className="text-muted text-sm">
          Describe your emergency. Our AI agents will coordinate a response.
        </p>
      </motion.div>

      {/* Text Input */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="w-full max-w-lg"
      >
        <div className="relative">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Trapped in building, need water and medical supplies..."
            rows={4}
            className="w-full resize-none rounded-2xl bg-white border border-border px-6 py-5 text-base text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 shadow-sm transition-all"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          {/* Character count */}
          <span className="absolute bottom-3 right-4 text-[11px] text-slate-300">
            {message.length}/500
          </span>
        </div>

        {/* AI Processing indicator */}
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{
            opacity: isProcessing ? 1 : 0,
            height: isProcessing ? "auto" : 0,
          }}
          className="flex items-center gap-2 mt-3 px-1 overflow-hidden"
        >
          <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
          <span className="text-xs text-primary font-medium">
            AI analyzing context...
          </span>
        </motion.div>
      </motion.div>

      {/* Suggested quick actions */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex flex-wrap gap-2 mt-6 max-w-lg justify-center"
      >
        {[
          "Need medical supplies",
          "Building collapse — trapped",
          "Flooding — need evacuation",
          "Fire spreading — need water",
        ].map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => setMessage(suggestion)}
            className="px-4 py-2 rounded-full text-xs font-medium bg-surface border border-border text-muted hover:text-slate-700 hover:border-slate-300 transition-all"
          >
            {suggestion}
          </button>
        ))}
      </motion.div>

      {/* Submit */}
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={handleSubmit}
        disabled={message.trim().length === 0}
        className="mt-10 flex items-center gap-2 px-10 py-4 rounded-full text-base font-semibold bg-primary text-white shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-shadow disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
      >
        <Send className="w-4 h-4" />
        Submit Request
      </motion.button>
    </div>
  );
}
