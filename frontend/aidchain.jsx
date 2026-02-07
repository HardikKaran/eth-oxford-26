import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants & Mock Data ───────────────────────────────────────────────────
const PIPELINE_STAGES = [
  { id: 1, key: "request", label: "Request", icon: "📡", desc: "Submit aid request with verified ID" },
  { id: 2, key: "location", label: "GPS Verify", icon: "🛰️", desc: "Galileo OS-NMA location & time auth" },
  { id: 3, key: "event", label: "Event Verify", icon: "🔍", desc: "FDC confirms local event occurrence" },
  { id: 4, key: "llm", label: "LLM Panel", icon: "🧠", desc: "AI network determines best action" },
  { id: 5, key: "contract", label: "Smart Contract", icon: "📜", desc: "Deploy contract & notify user" },
  { id: 6, key: "fulfill", label: "Fulfillment", icon: "🚁", desc: "Contractee fulfils the contract" },
  { id: 7, key: "receipt", label: "Receipt", icon: "✅", desc: "Confirm aid delivery via GPS/camera" },
  { id: 8, key: "settle", label: "Settlement", icon: "💱", desc: "FXRP → USDC/USDT payout" },
];

const AID_TYPES = [
  { id: "medical", label: "Medical Supplies", icon: "💊", fulfiller: "Zipline Drone", eta: "15-30 min" },
  { id: "food", label: "Food & Water", icon: "🍞", fulfiller: "Zipline Drone", eta: "20-45 min" },
  { id: "shelter", label: "Shelter Materials", icon: "🏠", fulfiller: "Local Authority", eta: "2-6 hrs" },
  { id: "rescue", label: "Search & Rescue", icon: "🆘", fulfiller: "Emergency Services", eta: "30-90 min" },
  { id: "comms", label: "Communications", icon: "📻", fulfiller: "Zipline Drone", eta: "15-30 min" },
  { id: "evac", label: "Evacuation", icon: "🚨", fulfiller: "Local Authority", eta: "1-4 hrs" },
];

const EVENTS = [
  { id: "flood_moz_2026", name: "Mozambique Flooding", type: "Flood", severity: "Critical", region: "Zambezia Province", coords: [-17.05, 36.87], active: true },
  { id: "eq_turkey_2026", name: "Eastern Turkey Earthquake", type: "Earthquake", severity: "Severe", region: "Van Province", coords: [38.49, 43.38], active: true },
  { id: "cyclone_bd_2026", name: "Bangladesh Cyclone", type: "Cyclone", severity: "Critical", region: "Chittagong Division", coords: [22.36, 91.78], active: true },
];

const MOCK_CONTRACTS = [
  { id: "0x7a3f...e291", aid: "Medical Supplies", status: "fulfilled", amount: "142.50 USDC", event: "Mozambique Flooding", time: "2h ago" },
  { id: "0x1b8c...d403", aid: "Food & Water", status: "in_transit", amount: "87.20 USDC", event: "Eastern Turkey Earthquake", time: "18m ago" },
  { id: "0x9e2d...a718", aid: "Search & Rescue", status: "pending_verify", amount: "320.00 USDC", event: "Bangladesh Cyclone", time: "5m ago" },
  { id: "0x4f1a...c956", aid: "Shelter Materials", status: "deployed", amount: "215.80 USDC", event: "Mozambique Flooding", time: "45m ago" },
];

const LLM_NODES = [
  { id: "node_alpha", name: "Sentinel-α", model: "Llama-3.3-70B", vote: null, confidence: 0 },
  { id: "node_beta", name: "Sentinel-β", model: "Mistral-Large", vote: null, confidence: 0 },
  { id: "node_gamma", name: "Sentinel-γ", model: "Qwen-72B", vote: null, confidence: 0 },
  { id: "node_delta", name: "Sentinel-δ", model: "DeepSeek-V3", vote: null, confidence: 0 },
  { id: "node_epsilon", name: "Sentinel-ε", model: "Claude-3.5", vote: null, confidence: 0 },
];

const FUND_DATA = {
  totalFXRP: 2_450_000,
  allocatedUSDC: 1_120_340,
  pendingSwaps: 87_500,
  contractsActive: 23,
  contractsFulfilled: 1_847,
  avgFulfillTime: "42 min",
};

// ─── Utility Functions ───────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomBetween = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const shortenAddr = (addr) => addr;
const statusColor = (s) => ({
  fulfilled: "#00E676",
  in_transit: "#FFD740",
  pending_verify: "#40C4FF",
  deployed: "#E040FB",
  failed: "#FF5252",
})[s] || "#888";

const statusLabel = (s) => ({
  fulfilled: "Fulfilled",
  in_transit: "In Transit",
  pending_verify: "Pending Verify",
  deployed: "Deployed",
  failed: "Failed",
})[s] || s;

// ─── Animated Background ─────────────────────────────────────────────────────
function AnimatedBg() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 20% 50%, rgba(0,200,150,0.06) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(0,120,255,0.05) 0%, transparent 50%), radial-gradient(ellipse at 50% 90%, rgba(200,0,255,0.03) 0%, transparent 50%), #0a0c10",
      }} />
      {[...Array(40)].map((_, i) => (
        <div key={i} style={{
          position: "absolute",
          width: 2, height: 2,
          borderRadius: "50%",
          background: `rgba(${randomBetween(100, 255)},${randomBetween(200, 255)},${randomBetween(150, 255)},${Math.random() * 0.4 + 0.1})`,
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          animation: `twinkle ${randomBetween(3, 8)}s ease-in-out infinite`,
          animationDelay: `${Math.random() * 5}s`,
        }} />
      ))}
    </div>
  );
}

// ─── Glass Card Component ────────────────────────────────────────────────────
function Glass({ children, style, hover, onClick, className }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "rgba(255,255,255,0.03)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 16,
        transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
        ...(hover && hovered ? {
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
          transform: "translateY(-2px)",
          boxShadow: "0 8px 32px rgba(0,200,150,0.08)",
        } : {}),
        ...(onClick ? { cursor: "pointer" } : {}),
        ...style,
      }}
      className={className}
    >
      {children}
    </div>
  );
}

// ─── Pipeline Visualizer ─────────────────────────────────────────────────────
function PipelineVisualizer({ activeStage, stages }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", padding: "20px 0" }}>
      {stages.map((stage, i) => {
        const isActive = stage.id === activeStage;
        const isComplete = stage.id < activeStage;
        const isPending = stage.id > activeStage;
        return (
          <div key={stage.id} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 90,
              opacity: isPending ? 0.35 : 1,
              transition: "all 0.5s ease",
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22,
                background: isActive
                  ? "linear-gradient(135deg, #00C896, #0088FF)"
                  : isComplete
                    ? "rgba(0,200,150,0.15)"
                    : "rgba(255,255,255,0.04)",
                border: isActive
                  ? "2px solid rgba(0,200,150,0.6)"
                  : isComplete
                    ? "1px solid rgba(0,200,150,0.3)"
                    : "1px solid rgba(255,255,255,0.06)",
                boxShadow: isActive ? "0 0 24px rgba(0,200,150,0.3)" : "none",
                animation: isActive ? "pulse-glow 2s ease-in-out infinite" : "none",
              }}>
                {isComplete ? "✓" : stage.icon}
              </div>
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: isActive ? "#00E6A8" : isComplete ? "#8BFFDB" : "#555",
                letterSpacing: "0.05em", textTransform: "uppercase",
                textAlign: "center",
              }}>{stage.label}</span>
            </div>
            {i < stages.length - 1 && (
              <div style={{
                width: 40, height: 2, flexShrink: 0,
                background: isComplete
                  ? "linear-gradient(90deg, #00C896, #0088FF)"
                  : "rgba(255,255,255,0.06)",
                margin: "0 4px", marginBottom: 24,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── LLM Panel Visualization ─────────────────────────────────────────────────
function LLMPanel({ nodes, consensus, deciding }) {
  return (
    <Glass style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 20 }}>🧠</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0", letterSpacing: "0.04em" }}>
          LLM Consensus Panel
        </span>
        {deciding && (
          <span style={{
            marginLeft: "auto", fontSize: 11, color: "#FFD740",
            animation: "blink 1s step-end infinite",
          }}>● DELIBERATING</span>
        )}
        {consensus && !deciding && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#00E676" }}>● CONSENSUS REACHED</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {nodes.map((node) => (
          <div key={node.id} style={{
            flex: "1 1 160px", padding: 14, borderRadius: 12,
            background: node.vote
              ? "rgba(0,200,150,0.06)"
              : "rgba(255,255,255,0.02)",
            border: `1px solid ${node.vote ? "rgba(0,200,150,0.2)" : "rgba(255,255,255,0.04)"}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#A0FFD8", marginBottom: 4 }}>{node.name}</div>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 8 }}>{node.model}</div>
            {node.vote ? (
              <>
                <div style={{ fontSize: 11, color: "#CCC", marginBottom: 4 }}>Vote: <span style={{ color: "#00E676" }}>{node.vote}</span></div>
                <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 2,
                    width: `${node.confidence}%`,
                    background: "linear-gradient(90deg, #00C896, #00E676)",
                    transition: "width 1s ease",
                  }} />
                </div>
                <div style={{ fontSize: 9, color: "#888", marginTop: 3 }}>{node.confidence}% confidence</div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: "#444" }}>Awaiting input...</div>
            )}
          </div>
        ))}
      </div>
    </Glass>
  );
}

// ─── Galileo OS-NMA Verification ─────────────────────────────────────────────
function GalileoVerifier({ verifying, verified, coords }) {
  return (
    <Glass style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 18 }}>🛰️</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0" }}>Galileo OS-NMA Authentication</span>
        {verifying && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#40C4FF", animation: "blink 1s step-end infinite" }}>
            ● AUTHENTICATING
          </span>
        )}
        {verified && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#00E676" }}>● VERIFIED</span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { label: "Signal Auth", value: verified ? "OSNMA Valid" : verifying ? "Checking..." : "Pending", color: verified ? "#00E676" : "#888" },
          { label: "Satellites", value: verified ? "8/8 locked" : verifying ? "Acquiring..." : "–", color: verified ? "#40C4FF" : "#888" },
          { label: "Coordinates", value: coords ? `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}` : "–", color: "#CCC" },
          { label: "Time Auth", value: verified ? "TAI Verified" : verifying ? "Syncing..." : "Pending", color: verified ? "#00E676" : "#888" },
          { label: "Spoofing Check", value: verified ? "CLEAR" : verifying ? "Analyzing..." : "–", color: verified ? "#00E676" : "#888" },
          { label: "Accuracy", value: verified ? "±2.1m" : "–", color: verified ? "#E040FB" : "#888" },
        ].map((item, i) => (
          <div key={i} style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ fontSize: 9, color: "#666", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>{item.label}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: item.color, fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</div>
          </div>
        ))}
      </div>
    </Glass>
  );
}

// ─── Smart Contract Card ─────────────────────────────────────────────────────
function ContractCard({ contract }) {
  return (
    <Glass hover style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 10 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#A0FFD8" }}>
          {contract.id}
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
          background: `${statusColor(contract.status)}15`,
          color: statusColor(contract.status),
          border: `1px solid ${statusColor(contract.status)}30`,
        }}>
          {statusLabel(contract.status)}
        </div>
      </div>
      <div style={{ fontSize: 13, color: "#DDD", fontWeight: 600, marginBottom: 4 }}>{contract.aid}</div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>{contract.event}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#FFD740", fontFamily: "'JetBrains Mono', monospace" }}>
          {contract.amount}
        </span>
        <span style={{ fontSize: 10, color: "#555" }}>{contract.time}</span>
      </div>
    </Glass>
  );
}

// ─── Fund Overview ───────────────────────────────────────────────────────────
function FundOverview() {
  return (
    <Glass style={{ padding: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0", marginBottom: 20, letterSpacing: "0.04em" }}>
        💱 Fund & Settlement
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        {[
          { label: "Total FXRP", value: FUND_DATA.totalFXRP.toLocaleString(), unit: "FXRP", color: "#E040FB" },
          { label: "Allocated", value: FUND_DATA.allocatedUSDC.toLocaleString(), unit: "USDC", color: "#00E676" },
          { label: "Pending Swaps", value: FUND_DATA.pendingSwaps.toLocaleString(), unit: "FXRP→USDC", color: "#FFD740" },
        ].map((item, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#666", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: item.color, fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{item.unit}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[
          { label: "Active Contracts", value: FUND_DATA.contractsActive, color: "#40C4FF" },
          { label: "Fulfilled", value: FUND_DATA.contractsFulfilled.toLocaleString(), color: "#00E676" },
          { label: "Avg Fulfillment", value: FUND_DATA.avgFulfillTime, color: "#E0E0E0" },
        ].map((item, i) => (
          <div key={i} style={{
            textAlign: "center", padding: 12, borderRadius: 10,
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)"
          }}>
            <div style={{ fontSize: 9, color: "#666", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: item.color, fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20, padding: 14, borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Settlement Pipeline</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
          {["FXRP", "→", "DEX Swap", "→", "USDC/USDT", "→", "Smart Contract", "→", "Contractee"].map((step, i) => (
            <span key={i} style={{
              fontSize: 11,
              color: step === "→" ? "#333" : "#A0FFD8",
              fontWeight: step === "→" ? 400 : 600,
              padding: step === "→" ? 0 : "4px 10px",
              borderRadius: 6,
              background: step === "→" ? "none" : "rgba(0,200,150,0.06)",
              border: step === "→" ? "none" : "1px solid rgba(0,200,150,0.15)",
              fontFamily: "'JetBrains Mono', monospace",
            }}>{step}</span>
          ))}
        </div>
      </div>
    </Glass>
  );
}

// ─── Active Events ───────────────────────────────────────────────────────────
function ActiveEvents({ events, onSelect, selected }) {
  return (
    <Glass style={{ padding: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0", marginBottom: 16, letterSpacing: "0.04em" }}>
        🔍 FDC Verified Events
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {events.map((ev) => (
          <div
            key={ev.id}
            onClick={() => onSelect(ev)}
            style={{
              padding: 14, borderRadius: 12, cursor: "pointer",
              background: selected?.id === ev.id ? "rgba(0,200,150,0.08)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${selected?.id === ev.id ? "rgba(0,200,150,0.3)" : "rgba(255,255,255,0.04)"}`,
              transition: "all 0.2s ease",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#E0E0E0" }}>{ev.name}</span>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                background: ev.severity === "Critical" ? "rgba(255,82,82,0.15)" : "rgba(255,215,64,0.15)",
                color: ev.severity === "Critical" ? "#FF5252" : "#FFD740",
                border: `1px solid ${ev.severity === "Critical" ? "rgba(255,82,82,0.3)" : "rgba(255,215,64,0.3)"}`,
              }}>{ev.severity}</span>
            </div>
            <div style={{ fontSize: 11, color: "#888" }}>{ev.type} • {ev.region}</div>
            <div style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>
              {ev.coords[0].toFixed(2)}°, {ev.coords[1].toFixed(2)}° {ev.active && <span style={{ color: "#00E676" }}>● ACTIVE</span>}
            </div>
          </div>
        ))}
      </div>
    </Glass>
  );
}

// ─── Request Form ────────────────────────────────────────────────────────────
function RequestForm({ onSubmit }) {
  const [selectedAid, setSelectedAid] = useState(null);
  const [urgency, setUrgency] = useState("high");
  const [details, setDetails] = useState("");
  const [govId, setGovId] = useState("ID-2026-XXXXX");

  return (
    <Glass style={{ padding: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0", marginBottom: 20, letterSpacing: "0.04em" }}>
        📡 New Aid Request
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Verified Identity</div>
        <div style={{
          padding: 12, borderRadius: 10,
          background: "rgba(0,200,150,0.06)", border: "1px solid rgba(0,200,150,0.15)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 16 }}>🪪</span>
          <div>
            <div style={{ fontSize: 12, color: "#A0FFD8", fontFamily: "'JetBrains Mono', monospace" }}>{govId}</div>
            <div style={{ fontSize: 9, color: "#666" }}>Government ID verified via zero-knowledge proof</div>
          </div>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#00E676" }}>✓ Verified</span>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Select Aid Type</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {AID_TYPES.map((aid) => (
            <div
              key={aid.id}
              onClick={() => setSelectedAid(aid.id)}
              style={{
                padding: 12, borderRadius: 10, cursor: "pointer", textAlign: "center",
                background: selectedAid === aid.id ? "rgba(0,200,150,0.1)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${selectedAid === aid.id ? "rgba(0,200,150,0.3)" : "rgba(255,255,255,0.04)"}`,
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 6 }}>{aid.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: selectedAid === aid.id ? "#A0FFD8" : "#CCC" }}>{aid.label}</div>
              <div style={{ fontSize: 9, color: "#555", marginTop: 3 }}>ETA: {aid.eta}</div>
              <div style={{ fontSize: 9, color: "#444", marginTop: 1 }}>{aid.fulfiller}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Urgency Level</div>
        <div style={{ display: "flex", gap: 8 }}>
          {["critical", "high", "medium"].map((u) => (
            <div
              key={u}
              onClick={() => setUrgency(u)}
              style={{
                flex: 1, padding: 10, borderRadius: 8, cursor: "pointer", textAlign: "center",
                fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                background: urgency === u
                  ? u === "critical" ? "rgba(255,82,82,0.15)" : u === "high" ? "rgba(255,215,64,0.15)" : "rgba(64,196,255,0.15)"
                  : "rgba(255,255,255,0.02)",
                color: urgency === u
                  ? u === "critical" ? "#FF5252" : u === "high" ? "#FFD740" : "#40C4FF"
                  : "#555",
                border: `1px solid ${urgency === u
                  ? u === "critical" ? "rgba(255,82,82,0.3)" : u === "high" ? "rgba(255,215,64,0.3)" : "rgba(64,196,255,0.3)"
                  : "rgba(255,255,255,0.04)"}`,
              }}
            >{u}</div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Additional Details</div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Describe your situation and specific needs..."
          style={{
            width: "100%", minHeight: 80, padding: 12, borderRadius: 10,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
            color: "#CCC", fontSize: 12, fontFamily: "'DM Sans', sans-serif",
            resize: "vertical", outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      <button
        onClick={() => selectedAid && onSubmit({ aidType: selectedAid, urgency, details })}
        disabled={!selectedAid}
        style={{
          width: "100%", padding: 14, borderRadius: 12, border: "none", cursor: selectedAid ? "pointer" : "not-allowed",
          background: selectedAid ? "linear-gradient(135deg, #00C896, #0088FF)" : "rgba(255,255,255,0.04)",
          color: selectedAid ? "#FFF" : "#555",
          fontSize: 14, fontWeight: 700, letterSpacing: "0.06em",
          transition: "all 0.3s ease",
        }}
      >
        SUBMIT AID REQUEST
      </button>
    </Glass>
  );
}

// ─── Log/Activity Feed ───────────────────────────────────────────────────────
function ActivityFeed({ logs }) {
  const feedRef = useRef(null);
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [logs]);

  return (
    <Glass style={{ padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0", marginBottom: 14, letterSpacing: "0.04em" }}>
        📋 Activity Log
      </div>
      <div ref={feedRef} style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {logs.map((log, i) => (
          <div key={i} style={{
            padding: 10, borderRadius: 8,
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.03)",
            animation: i === logs.length - 1 ? "fadeSlideIn 0.3s ease" : "none",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 10, color: log.color || "#A0FFD8", fontWeight: 600 }}>{log.stage}</span>
              <span style={{ fontSize: 9, color: "#444", fontFamily: "'JetBrains Mono', monospace" }}>{log.time}</span>
            </div>
            <div style={{ fontSize: 11, color: "#999" }}>{log.message}</div>
          </div>
        ))}
        {logs.length === 0 && (
          <div style={{ fontSize: 12, color: "#444", textAlign: "center", padding: 20 }}>No activity yet. Submit a request to begin.</div>
        )}
      </div>
    </Glass>
  );
}

// ─── Receipt / Delivery Confirmation ─────────────────────────────────────────
function DeliveryReceipt({ method, confirmed }) {
  return (
    <Glass style={{ padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0", marginBottom: 14 }}>
        ✅ Delivery Receipt
      </div>
      {method === "drone" ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {[
              { label: "Drone ID", value: "ZPL-4472", color: "#40C4FF" },
              { label: "Drop GPS", value: "-17.0523, 36.8714", color: "#E040FB" },
              { label: "Camera Confirm", value: confirmed ? "VERIFIED" : "PENDING", color: confirmed ? "#00E676" : "#FFD740" },
              { label: "Payload", value: "Medical Kit A3", color: "#CCC" },
            ].map((item, i) => (
              <div key={i} style={{ padding: 8, borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: item.color, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>{item.value}</div>
              </div>
            ))}
          </div>
          {confirmed && (
            <div style={{
              padding: 10, borderRadius: 8, textAlign: "center",
              background: "rgba(0,230,118,0.08)", border: "1px solid rgba(0,230,118,0.2)",
            }}>
              <span style={{ fontSize: 12, color: "#00E676", fontWeight: 700 }}>📸 Camera + GPS match confirmed — Aid delivered</span>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {[
              { label: "Authority", value: "Local Emergency", color: "#40C4FF" },
              { label: "Officer ID", value: "OFF-7291", color: "#E040FB" },
              { label: "Confirmation", value: confirmed ? "SIGNED" : "AWAITING", color: confirmed ? "#00E676" : "#FFD740" },
              { label: "Timestamp", value: new Date().toISOString().slice(0, 19), color: "#CCC" },
            ].map((item, i) => (
              <div key={i} style={{ padding: 8, borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: item.color, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>{item.value}</div>
              </div>
            ))}
          </div>
          {confirmed && (
            <div style={{
              padding: 10, borderRadius: 8, textAlign: "center",
              background: "rgba(0,230,118,0.08)", border: "1px solid rgba(0,230,118,0.2)",
            }}>
              <span style={{ fontSize: 12, color: "#00E676", fontWeight: 700 }}>✍️ Authority signature verified — Aid delivered</span>
            </div>
          )}
        </div>
      )}
    </Glass>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function AidChainApp() {
  const [view, setView] = useState("dashboard");
  const [activeStage, setActiveStage] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState(EVENTS[0]);
  const [logs, setLogs] = useState([]);
  const [llmNodes, setLlmNodes] = useState(LLM_NODES.map(n => ({ ...n })));
  const [llmDeciding, setLlmDeciding] = useState(false);
  const [llmConsensus, setLlmConsensus] = useState(false);
  const [galileoVerifying, setGalileoVerifying] = useState(false);
  const [galileoVerified, setGalileoVerified] = useState(false);
  const [deliveryConfirmed, setDeliveryConfirmed] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState("drone");

  const addLog = useCallback((stage, message, color) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { stage, message, time, color }]);
  }, []);

  const simulatePipeline = useCallback(async (request) => {
    setIsProcessing(true);
    setActiveStage(1);
    setGalileoVerified(false);
    setLlmConsensus(false);
    setLlmDeciding(false);
    setDeliveryConfirmed(false);
    setLlmNodes(LLM_NODES.map(n => ({ ...n })));
    setLogs([]);

    const aidInfo = AID_TYPES.find(a => a.id === request.aidType);
    setDeliveryMethod(aidInfo?.fulfiller?.includes("Drone") ? "drone" : "human");

    // Stage 1: Request
    addLog("REQUEST", `Aid request submitted: ${aidInfo?.label} (${request.urgency} urgency)`, "#A0FFD8");
    await sleep(1200);

    // Stage 2: Galileo
    setActiveStage(2);
    setGalileoVerifying(true);
    addLog("GALILEO", "Initiating OS-NMA satellite authentication...", "#40C4FF");
    await sleep(1500);
    addLog("GALILEO", "Signal acquired — 8 Galileo satellites locked", "#40C4FF");
    await sleep(1000);
    addLog("GALILEO", "OSNMA signature verified — anti-spoofing CLEAR", "#40C4FF");
    await sleep(800);
    setGalileoVerifying(false);
    setGalileoVerified(true);
    addLog("GALILEO", `Location authenticated: ${selectedEvent.coords[0].toFixed(4)}°, ${selectedEvent.coords[1].toFixed(4)}° ±2.1m`, "#00E676");
    await sleep(800);

    // Stage 3: FDC Event Verification
    setActiveStage(3);
    addLog("FDC", `Querying FDC oracle for events near ${selectedEvent.region}...`, "#E040FB");
    await sleep(1200);
    addLog("FDC", `Event confirmed: "${selectedEvent.name}" — ${selectedEvent.type} (${selectedEvent.severity})`, "#E040FB");
    addLog("FDC", "Cross-referencing: GDACS, ReliefWeb, USGS, local reports — MATCH", "#00E676");
    await sleep(1000);

    // Stage 4: LLM Panel
    setActiveStage(4);
    setLlmDeciding(true);
    addLog("LLM PANEL", "Distributing request to decentralized LLM consensus panel...", "#FFD740");
    await sleep(800);

    const voteOptions = [aidInfo?.label || "Medical Supplies"];
    for (let i = 0; i < LLM_NODES.length; i++) {
      await sleep(randomBetween(600, 1200));
      const confidence = randomBetween(82, 99);
      setLlmNodes(prev => prev.map((n, idx) =>
        idx === i ? { ...n, vote: voteOptions[0], confidence } : n
      ));
      addLog("LLM PANEL", `${LLM_NODES[i].name} (${LLM_NODES[i].model}) votes: ${voteOptions[0]} [${confidence}%]`, "#FFD740");
    }
    await sleep(600);
    setLlmDeciding(false);
    setLlmConsensus(true);
    addLog("LLM PANEL", `CONSENSUS REACHED: Deploy ${aidInfo?.label} via ${aidInfo?.fulfiller}`, "#00E676");
    await sleep(800);

    // Stage 5: Smart Contract
    setActiveStage(5);
    const contractAddr = `0x${Math.random().toString(16).slice(2, 6)}...${Math.random().toString(16).slice(2, 6)}`;
    const amount = (Math.random() * 200 + 50).toFixed(2);
    addLog("CONTRACT", `Deploying smart contract to XRPL EVM sidechain...`, "#E040FB");
    await sleep(1000);
    addLog("CONTRACT", `Contract ${contractAddr} deployed — Amount: ${amount} USDC`, "#E040FB");
    addLog("CONTRACT", `FXRP → USDC swap initiated via DEX aggregator`, "#FFD740");
    await sleep(800);
    addLog("CONTRACT", "User notified via push + SMS fallback", "#A0FFD8");
    await sleep(800);

    // Stage 6: Fulfillment
    setActiveStage(6);
    if (aidInfo?.fulfiller?.includes("Drone")) {
      addLog("FULFILL", "Zipline dispatch request sent — Drone ZPL-4472 assigned", "#40C4FF");
      await sleep(1200);
      addLog("FULFILL", "Drone launched — ETA 22 minutes to drop zone", "#40C4FF");
      await sleep(1000);
      addLog("FULFILL", "Drone en route — 14km remaining, altitude 150m", "#40C4FF");
    } else {
      addLog("FULFILL", `Local authority dispatch request sent — ${selectedEvent.region}`, "#40C4FF");
      await sleep(1200);
      addLog("FULFILL", "Emergency services team assigned — Unit ESR-104", "#40C4FF");
      await sleep(1000);
      addLog("FULFILL", "Team dispatched — ETA 45 minutes", "#40C4FF");
    }
    await sleep(1500);

    // Stage 7: Receipt
    setActiveStage(7);
    if (aidInfo?.fulfiller?.includes("Drone")) {
      addLog("RECEIPT", "Drone approaching drop zone — Initiating descent", "#00E676");
      await sleep(1000);
      addLog("RECEIPT", "Payload released — GPS drop confirmed at target coordinates", "#00E676");
      await sleep(800);
      addLog("RECEIPT", "Camera verification — Package received by requester ✓", "#00E676");
    } else {
      addLog("RECEIPT", "Emergency team arrived at location", "#00E676");
      await sleep(1000);
      addLog("RECEIPT", "Authority officer confirms aid delivery — Digital signature received", "#00E676");
    }
    setDeliveryConfirmed(true);
    await sleep(800);

    // Stage 8: Settlement
    setActiveStage(8);
    addLog("SETTLE", `Smart contract ${contractAddr} — Delivery confirmed on-chain`, "#FFD740");
    await sleep(800);
    addLog("SETTLE", `${amount} USDC released to ${aidInfo?.fulfiller} wallet`, "#00E676");
    await sleep(600);
    addLog("SETTLE", "Transaction finalized — All parties settled ✓", "#00E676");

    setIsProcessing(false);
  }, [addLog, selectedEvent]);

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "◈" },
    { id: "request", label: "New Request", icon: "+" },
    { id: "contracts", label: "Contracts", icon: "📜" },
    { id: "fund", label: "Fund", icon: "💱" },
  ];

  return (
    <div style={{
      minHeight: "100vh", color: "#E0E0E0",
      fontFamily: "'DM Sans', sans-serif",
      position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800&family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        @keyframes twinkle {
          0%, 100% { opacity: 0.1; }
          50% { opacity: 0.8; }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 16px rgba(0,200,150,0.2); }
          50% { box-shadow: 0 0 32px rgba(0,200,150,0.4); }
        }
        @keyframes blink {
          50% { opacity: 0; }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <AnimatedBg />

      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 100,
        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        background: "rgba(10,12,16,0.8)",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        padding: "14px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #00C896, #0088FF)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800,
          }}>⛓</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Syne', sans-serif", letterSpacing: "-0.02em", background: "linear-gradient(135deg, #A0FFD8, #40C4FF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              AidChain
            </div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: -1 }}>
              Decentralised Humanitarian Relief Protocol
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              style={{
                padding: "8px 18px", borderRadius: 10, border: "none", cursor: "pointer",
                background: view === item.id ? "rgba(0,200,150,0.12)" : "transparent",
                color: view === item.id ? "#A0FFD8" : "#666",
                fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                transition: "all 0.2s ease",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isProcessing && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                border: "2px solid transparent",
                borderTop: "2px solid #00E676",
                animation: "spin 0.8s linear infinite",
              }} />
              <span style={{ fontSize: 11, color: "#00E676" }}>Processing</span>
            </div>
          )}
          <div style={{
            padding: "6px 14px", borderRadius: 8,
            background: "rgba(0,200,150,0.08)", border: "1px solid rgba(0,200,150,0.2)",
            fontSize: 10, color: "#A0FFD8", fontFamily: "'JetBrains Mono', monospace",
          }}>
            XRPL ● Connected
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ position: "relative", zIndex: 1, padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>

        {/* Pipeline - always visible when processing */}
        {activeStage > 0 && (
          <div style={{ marginBottom: 24 }}>
            <PipelineVisualizer activeStage={activeStage} stages={PIPELINE_STAGES} />
          </div>
        )}

        {/* Dashboard View */}
        {view === "dashboard" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <ActiveEvents events={EVENTS} onSelect={setSelectedEvent} selected={selectedEvent} />
              <GalileoVerifier
                verifying={galileoVerifying}
                verified={galileoVerified}
                coords={selectedEvent?.coords}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <LLMPanel nodes={llmNodes} consensus={llmConsensus} deciding={llmDeciding} />
              <ActivityFeed logs={logs} />
              {deliveryConfirmed && (
                <DeliveryReceipt method={deliveryMethod} confirmed={deliveryConfirmed} />
              )}
            </div>
          </div>
        )}

        {/* Request View */}
        {view === "request" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <RequestForm onSubmit={(req) => { setView("dashboard"); simulatePipeline(req); }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <ActiveEvents events={EVENTS} onSelect={setSelectedEvent} selected={selectedEvent} />
              <Glass style={{ padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0", marginBottom: 14 }}>
                  ℹ️ How It Works
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {PIPELINE_STAGES.map((stage) => (
                    <div key={stage.id} style={{ display: "flex", gap: 10, alignItems: "start" }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14,
                      }}>{stage.icon}</div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#CCC" }}>{stage.label}</div>
                        <div style={{ fontSize: 10, color: "#666" }}>{stage.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Glass>
            </div>
          </div>
        )}

        {/* Contracts View */}
        {view === "contracts" && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0", marginBottom: 20, letterSpacing: "0.04em" }}>
              📜 Smart Contracts
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
              {MOCK_CONTRACTS.map((c, i) => (
                <ContractCard key={i} contract={c} />
              ))}
            </div>
            <div style={{ marginTop: 24 }}>
              <Glass style={{ padding: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#E0E0E0", marginBottom: 14 }}>Contract Lifecycle</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                  {["Deployed", "→", "Fulfiller Assigned", "→", "In Transit", "→", "Delivery Confirmed", "→", "FXRP Swap", "→", "USDC Payout", "→", "Settled"].map((s, i) => (
                    <span key={i} style={{
                      fontSize: 10, fontWeight: s === "→" ? 400 : 600,
                      color: s === "→" ? "#333" : "#A0FFD8",
                      padding: s === "→" ? 0 : "4px 10px", borderRadius: 6,
                      background: s === "→" ? "none" : "rgba(0,200,150,0.06)",
                      border: s === "→" ? "none" : "1px solid rgba(0,200,150,0.15)",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>{s}</span>
                  ))}
                </div>
              </Glass>
            </div>
          </div>
        )}

        {/* Fund View */}
        {view === "fund" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <FundOverview />
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <Glass style={{ padding: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0", marginBottom: 16 }}>🔐 Trust Architecture</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { title: "Zero-Knowledge ID", desc: "Government ID verified without revealing personal data. ZK-proof ensures uniqueness and eligibility.", icon: "🪪" },
                    { title: "Galileo OS-NMA", desc: "Authenticated GNSS prevents location spoofing. Cryptographic signal verification ensures physical presence.", icon: "🛰️" },
                    { title: "FDC Oracle", desc: "Flare Data Connector aggregates GDACS, USGS, ReliefWeb to verify events are real and ongoing.", icon: "🔍" },
                    { title: "LLM Consensus", desc: "5-node heterogeneous AI panel prevents single-model bias. Supermajority required for action.", icon: "🧠" },
                    { title: "XRPL Smart Contracts", desc: "Escrow contracts with multi-sig release. Funds only released on verified delivery confirmation.", icon: "📜" },
                    { title: "Dual Verification", desc: "Drone: GPS + camera. Human: Authority digital signature. Both create immutable on-chain receipt.", icon: "✅" },
                  ].map((item, i) => (
                    <div key={i} style={{
                      padding: 14, borderRadius: 10,
                      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
                      display: "flex", gap: 12, alignItems: "start",
                    }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#A0FFD8", marginBottom: 3 }}>{item.title}</div>
                        <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Glass>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
