import { ethers } from "ethers";
import { createServiceLogger } from "../utils/logger.js";
import config from "../config/index.js";

const log = createServiceLogger("llm-panel");

/**
 * LLM Consensus Panel Service
 *
 * A decentralized panel of heterogeneous LLM nodes that collectively decide:
 *   1. Whether the aid request is legitimate and should be approved
 *   2. What type of aid is most appropriate
 *   3. Which fulfiller type (drone vs human) is best
 *   4. Estimated cost for the aid delivery
 *
 * Supermajority (>2/3) voting. Heterogeneous model families prevent
 * single-model bias or adversarial manipulation.
 */

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildPanelPrompt(request, verification, eventData) {
  return `You are a humanitarian aid assessment node in the AidChain decentralized protocol.

CONTEXT:
- A user has requested humanitarian aid
- Their location has been cryptographically verified via Galileo OS-NMA
- The disaster event has been confirmed by the Flare Data Connector (FDC)

VERIFIED REQUEST DATA:
- Aid Type Requested: ${request.aidType}
- Urgency Level: ${request.urgency}
- Location: ${request.lat.toFixed(6)}, ${request.lng.toFixed(6)} (Galileo-authenticated, ±${verification.accuracy}m)
- Details: ${request.details || "No additional details"}

VERIFIED EVENT:
- Event: ${eventData.event?.eventName || "Unknown"}
- Type: ${eventData.event?.eventType || "Unknown"}
- Severity: ${eventData.event?.severity || "Unknown"}
- Region: ${eventData.event?.region || "Unknown"}
- Distance from user: ${eventData.event?.distanceFromUser?.toFixed(1) || "?"}km
- Data sources: ${eventData.event?.sources?.join(", ") || "None"}

AVAILABLE AID TYPES:
0=Medical, 1=Food/Water, 2=Shelter, 3=Search&Rescue, 4=Comms, 5=Evacuation

FULFILLER TYPES:
0 = Drone (Zipline) — fast, for small/medium packages
1 = Human / Authority — for large-scale, hands-on assistance

Respond with ONLY a JSON object:
{
  "approved": true/false,
  "reason": "brief explanation",
  "recommendedAid": <0-5>,
  "fulfillerType": <0 or 1>,
  "estimatedCostUSD": <number>,
  "confidence": <0-100>,
  "riskFactors": [],
  "priorityScore": <1-10>
}`;
}

// ─── Single Node Query ───────────────────────────────────────────────────────

async function queryNode(node, prompt) {
  const startTime = Date.now();

  try {
    if (!node.url) {
      return simulateNodeResponse(node);
    }

    const response = await fetch(node.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: node.model,
        messages: [
          { role: "system", content: "You are a humanitarian aid assessment AI. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const cleaned = content.replace(/```json\s*|```\s*/g, "").trim();
    const decision = JSON.parse(cleaned);
    const latency = Date.now() - startTime;

    log.debug(`Node ${node.name} responded in ${latency}ms: approved=${decision.approved}`);
    return { nodeId: node.id, nodeName: node.name, model: node.model, decision, latency, error: null };
  } catch (err) {
    log.warn(`Node ${node.name} failed: ${err.message}`);
    return { nodeId: node.id, nodeName: node.name, model: node.model, decision: null, latency: Date.now() - startTime, error: err.message };
  }
}

function simulateNodeResponse(node) {
  const approved = Math.random() > 0.1;
  const recommendedAid = Math.floor(Math.random() * 3);
  const fulfillerType = recommendedAid <= 1 ? 0 : 1;

  return {
    nodeId: node.id, nodeName: node.name, model: node.model,
    decision: {
      approved,
      reason: approved ? "Request verified against confirmed disaster event." : "Insufficient evidence.",
      recommendedAid,
      fulfillerType,
      estimatedCostUSD: Math.round(50 + Math.random() * 250),
      confidence: Math.round(75 + Math.random() * 25),
      riskFactors: [],
      priorityScore: Math.round(5 + Math.random() * 5),
    },
    latency: Math.round(500 + Math.random() * 2000),
    error: null,
  };
}

// ─── Full Consensus ──────────────────────────────────────────────────────────

/**
 * Run the full LLM consensus panel and aggregate results.
 *
 * @param {Object} request       - The aid request data
 * @param {Object} verification  - Galileo verification result
 * @param {Object} eventData     - FDC event verification result
 * @returns {Promise<ConsensusResult>}
 */
export async function runConsensus(request, verification, eventData) {
  log.info(`Running LLM consensus panel for request`);

  const nodes = config.llmNodes;
  const prompt = buildPanelPrompt(request, verification, eventData);

  // Query all nodes in parallel
  const results = await Promise.all(nodes.map((node) => queryNode(node, prompt)));

  // Filter out failed nodes
  const validResults = results.filter((r) => r.decision !== null);
  const failedNodes = results.filter((r) => r.decision === null);

  log.info(`Panel results: ${validResults.length} valid, ${failedNodes.length} failed`);

  if (validResults.length < 3) {
    log.error("Insufficient valid responses from LLM panel");
    return {
      approved: false,
      reason: "Insufficient LLM node responses for consensus",
      nodeCount: results.length,
      validCount: validResults.length,
      approvalCount: 0,
      results,
      consensus: null,
      consensusHash: ethers.ZeroHash,
    };
  }

  // Count approval votes
  const approvalVotes = validResults.filter((r) => r.decision.approved);
  const approvalCount = approvalVotes.length;
  const totalValid = validResults.length;

  // Supermajority check: > 2/3 must approve
  const approved = approvalCount * 3 > totalValid * 2;

  // Aggregate recommended aid type (majority vote among approvers)
  let recommendedAid = 0;
  let fulfillerType = 0;
  let estimatedCostUSD = 0;
  let avgConfidence = 0;

  if (approved && approvalVotes.length > 0) {
    // Majority vote on aid type
    const aidVotes = {};
    for (const r of approvalVotes) {
      const aid = r.decision.recommendedAid;
      aidVotes[aid] = (aidVotes[aid] || 0) + 1;
    }
    recommendedAid = parseInt(
      Object.entries(aidVotes).sort((a, b) => b[1] - a[1])[0][0]
    );

    // Majority vote on fulfiller type
    const fulfillerVotes = {};
    for (const r of approvalVotes) {
      const ft = r.decision.fulfillerType;
      fulfillerVotes[ft] = (fulfillerVotes[ft] || 0) + 1;
    }
    fulfillerType = parseInt(
      Object.entries(fulfillerVotes).sort((a, b) => b[1] - a[1])[0][0]
    );

    // Median cost estimate (more robust than mean)
    const costs = approvalVotes.map((r) => r.decision.estimatedCostUSD).sort((a, b) => a - b);
    estimatedCostUSD = costs[Math.floor(costs.length / 2)];

    // Average confidence
    avgConfidence = Math.round(
      approvalVotes.reduce((sum, r) => sum + r.decision.confidence, 0) / approvalVotes.length
    );
  }

  // Build consensus transcript for on-chain hash
  const transcript = {
    timestamp: new Date().toISOString(),
    nodeCount: results.length,
    validCount: totalValid,
    approvalCount,
    approved,
    recommendedAid,
    fulfillerType,
    estimatedCostUSD,
    avgConfidence,
    nodeDecisions: validResults.map((r) => ({
      nodeId: r.nodeId,
      model: r.model,
      approved: r.decision.approved,
      recommendedAid: r.decision.recommendedAid,
      confidence: r.decision.confidence,
      latency: r.latency,
    })),
  };

  const consensusHash = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify(transcript))
  );

  const reason = approved
    ? `Approved by ${approvalCount}/${totalValid} nodes (${avgConfidence}% avg confidence)`
    : `Rejected: only ${approvalCount}/${totalValid} nodes approved (supermajority not met)`;

  log.info(`Consensus: ${reason}`);

  return {
    approved,
    reason,
    nodeCount: results.length,
    validCount: totalValid,
    approvalCount,
    recommendedAid,
    fulfillerType,
    estimatedCostUSD,
    avgConfidence,
    results,
    transcript,
    consensusHash,
  };
}
