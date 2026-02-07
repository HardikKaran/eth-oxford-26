"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import SafetyCheck from "@/components/SafetyCheck";
import IntakeForm from "@/components/IntakeForm";
import Dashboard from "@/components/Dashboard";

type Stage = "safety" | "intake" | "dashboard";

const pageVariants = {
  initial: { opacity: 0, x: 60 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -60 },
};

export default function App() {
  const [stage, setStage] = useState<Stage>("safety");
  const [userMessage, setUserMessage] = useState("");

  const handleRequestAssistance = () => setStage("intake");

  const handleIntakeSubmit = (message: string) => {
    setUserMessage(message);
    setStage("dashboard");
  };

  const handleBackToSafety = () => setStage("safety");
  const handleBackToIntake = () => setStage("intake");

  return (
    <AnimatePresence mode="wait">
      {stage === "safety" && (
        <motion.div
          key="safety"
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.4, ease: "easeInOut" }}
        >
          <SafetyCheck onRequestAssistance={handleRequestAssistance} />
        </motion.div>
      )}

      {stage === "intake" && (
        <motion.div
          key="intake"
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.4, ease: "easeInOut" }}
        >
          <IntakeForm onSubmit={handleIntakeSubmit} onBack={handleBackToSafety} />
        </motion.div>
      )}

      {stage === "dashboard" && (
        <motion.div
          key="dashboard"
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className="h-screen"
        >
          <Dashboard userMessage={userMessage} onBack={handleBackToIntake} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
