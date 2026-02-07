import { ethers } from "ethers";
import { createServiceLogger } from "../utils/logger.js";
import { verifyLocation } from "./galileo.js";
import { verifyEvent } from "./fdc.js";
import { runConsensus } from "./llmPanel.js";
import { dispatchFulfiller, getFulfillerAddress } from "./fulfillment.js";
import * as blockchain from "./blockchain.js";

const log = createServiceLogger("pipeline");

/**
 * Pipeline Orchestrator
 *
 * Coordinates the full 8-stage AidChain pipeline:
 *
 *   1. REQUEST      → User submits, validated, stored on-chain
 *   2. GPS VERIFY   → Galileo OS-NMA authenticates location + time
 *   3. EVENT VERIFY → FDC confirms disaster in user's area
 *   4. LLM PANEL    → Consensus panel determines best course of action
 *   5. CONTRACT     → Smart contract deployed, FXRP→USDC swap, fund escrow
 *   6. FULFILLMENT  → Drone or authority dispatched
 *   7. RECEIPT      → Delivery verified (GPS+camera / authority signature)
 *   8. SETTLEMENT   → Payout released to fulfiller
 *
 * Each stage emits events that can be consumed by WebSocket clients
 * for real-time UI updates.
 */

// ─── Pipeline State ──────────────────────────────────────────────────────────

const activePipelines = new Map(); // requestId → PipelineState

const STAGES = {
  REQUEST: 1,
  GPS_VERIFY: 2,
  EVENT_VERIFY: 3,
  LLM_PANEL: 4,
  CONTRACT: 5,
  FULFILLMENT: 6,
  RECEIPT: 7,
  SETTLEMENT: 8,
};

// ─── Event Emitter (for WebSocket broadcast) ─────────────────────────────────

const listeners = new Set();

export function onPipelineEvent(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function emit(requestId, stage, data) {
  const event = {
    requestId,
    stage,
    timestamp: new Date().toISOString(),
    ...data,
  };
  for (const cb of listeners) {
    try { cb(event); } catch (e) { /* swallow */ }
  }
  return event;
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

/**
 * Execute the full pipeline for an aid request.
 *
 * This is called after the on-chain request is created (stage 1 happens
 * partly on the client side when the user calls requestAid()).
 *
 * @param {Object} params
 * @param {number}  params.requestId    - On-chain request ID
 * @param {string}  params.aidType      - Requested aid type
 * @param {string}  params.urgency      - Urgency level
 * @param {number}  params.lat          - Claimed latitude
 * @param {number}  params.lng          - Claimed longitude
 * @param {string}  params.details      - Free-text details
 * @param {Object}  params.gnssData     - Raw GNSS data from device
 * @param {string}  params.deviceId     - Device identifier
 */
export async function executePipeline(params) {
  const { requestId } = params;
  log.info(`═══ Starting pipeline for request #${requestId} ═══`);

  const state = {
    requestId,
    currentStage: STAGES.REQUEST,
    startTime: Date.now(),
    stages: {},
    error: null,
  };
  activePipelines.set(requestId, state);

  try {
    // ── Stage 1: Request (already on-chain) ───────────────────────────
    state.currentStage = STAGES.REQUEST;
    emit(requestId, "request", { status: "confirmed", message: "Aid request confirmed on-chain" });
    state.stages.request = { completedAt: Date.now() };

    // ── Stage 2: Galileo OS-NMA Verification ──────────────────────────
    state.currentStage = STAGES.GPS_VERIFY;
    emit(requestId, "gps_verify", { status: "started", message: "Initiating Galileo OS-NMA authentication..." });

    const galileoResult = await verifyLocation({
      claimedLat: params.lat,
      claimedLng: params.lng,
      gnssData: params.gnssData || {},
      deviceId: params.deviceId || "unknown",
    });

    if (!galileoResult.valid) {
      throw new PipelineError("GPS_VERIFY", `Galileo verification failed: ${galileoResult.reason}`);
    }

    // Submit verification on-chain
    const fdcEventIdPlaceholder = ethers.ZeroHash; // Will be updated in stage 3
    await blockchain.submitVerification(
      requestId,
      galileoResult.proofHash,
      fdcEventIdPlaceholder,
      ethers.ZeroHash
    );

    emit(requestId, "gps_verify", {
      status: "completed",
      message: `Location authenticated: ${galileoResult.lat.toFixed(4)}, ${galileoResult.lng.toFixed(4)} ±${galileoResult.accuracy}m`,
      data: galileoResult,
    });
    state.stages.gpsVerify = { completedAt: Date.now(), result: galileoResult };

    // ── Stage 3: FDC Event Verification ───────────────────────────────
    state.currentStage = STAGES.EVENT_VERIFY;
    emit(requestId, "event_verify", { status: "started", message: "Querying FDC for local events..." });

    const fdcResult = await verifyEvent({
      lat: galileoResult.lat,
      lng: galileoResult.lng,
      claimedEvent: params.details || params.aidType,
    });

    if (!fdcResult.verified) {
      throw new PipelineError("EVENT_VERIFY", `Event verification failed: ${fdcResult.reason}`);
    }

    // Update the on-chain verification with FDC data
    // (In production, this would be a separate tx or bundled via the oracle)
    emit(requestId, "event_verify", {
      status: "completed",
      message: `Event confirmed: "${fdcResult.event.eventName}" (${fdcResult.event.eventType}, ${fdcResult.event.severity})`,
      data: fdcResult,
    });
    state.stages.eventVerify = { completedAt: Date.now(), result: fdcResult };

    // ── Stage 4: LLM Consensus Panel ──────────────────────────────────
    state.currentStage = STAGES.LLM_PANEL;
    emit(requestId, "llm_panel", { status: "started", message: "Distributing to LLM consensus panel..." });

    const consensusResult = await runConsensus(params, galileoResult, fdcResult);

    if (!consensusResult.approved) {
      // Submit rejection on-chain
      await blockchain.submitConsensusOnChain(
        requestId, false, 0, 0, 0,
        consensusResult.consensusHash,
        consensusResult.nodeCount,
        consensusResult.approvalCount
      );
      throw new PipelineError("LLM_PANEL", `Consensus rejected: ${consensusResult.reason}`);
    }

    // Submit approval on-chain
    await blockchain.submitConsensusOnChain(
      requestId,
      true,
      consensusResult.recommendedAid,
      consensusResult.fulfillerType,
      consensusResult.estimatedCostUSD,
      consensusResult.consensusHash,
      consensusResult.nodeCount,
      consensusResult.approvalCount
    );

    emit(requestId, "llm_panel", {
      status: "completed",
      message: `Consensus reached: ${consensusResult.reason}`,
      data: {
        approved: true,
        recommendedAid: consensusResult.recommendedAid,
        fulfillerType: consensusResult.fulfillerType,
        estimatedCostUSD: consensusResult.estimatedCostUSD,
        nodeResults: consensusResult.results.map((r) => ({
          name: r.nodeName,
          model: r.model,
          approved: r.decision?.approved,
          confidence: r.decision?.confidence,
        })),
      },
    });
    state.stages.llmPanel = { completedAt: Date.now(), result: consensusResult };

    // ── Stage 5: Smart Contract Funding ───────────────────────────────
    state.currentStage = STAGES.CONTRACT;
    emit(requestId, "contract", { status: "started", message: "Deploying smart contract escrow..." });

    const fulfillerAddr = getFulfillerAddress(consensusResult.fulfillerType);
    await blockchain.assignFulfillerOnChain(requestId, fulfillerAddr);

    emit(requestId, "contract", {
      status: "completed",
      message: `Escrow funded: ${consensusResult.estimatedCostUSD} USDC → Fulfiller assigned`,
      data: { fulfillerAddress: fulfillerAddr, amount: consensusResult.estimatedCostUSD },
    });
    state.stages.contract = { completedAt: Date.now() };

    // ── Stage 6: Dispatch Fulfiller ───────────────────────────────────
    state.currentStage = STAGES.FULFILLMENT;
    emit(requestId, "fulfillment", { status: "started", message: "Dispatching fulfiller..." });

    const AID_NAMES = ["medical", "food", "shelter", "rescue", "comms", "evacuation"];
    const dispatchResult = await dispatchFulfiller({
      requestId,
      fulfillerType: consensusResult.fulfillerType,
      aidType: AID_NAMES[consensusResult.recommendedAid] || "medical",
      lat: galileoResult.lat,
      lng: galileoResult.lng,
      estimatedCost: consensusResult.estimatedCostUSD,
    });

    if (!dispatchResult.success) {
      throw new PipelineError("FULFILLMENT", `Dispatch failed: ${dispatchResult.error}`);
    }

    emit(requestId, "fulfillment", {
      status: "completed",
      message: `Fulfiller dispatched — ETA: ${dispatchResult.estimatedEta}`,
      data: dispatchResult,
    });
    state.stages.fulfillment = { completedAt: Date.now(), result: dispatchResult };

    // ── Stages 7+8 happen asynchronously when delivery is confirmed ──
    // The fulfiller (or webhook) calls the /api/delivery/confirm endpoint,
    // which triggers completeDelivery() below.

    emit(requestId, "awaiting_delivery", {
      status: "pending",
      message: "Awaiting delivery confirmation...",
    });

    log.info(`Pipeline stages 1-6 complete for request #${requestId}. Awaiting delivery.`);
    return { success: true, state, dispatchResult };

  } catch (err) {
    state.error = err.message;
    const stage = err instanceof PipelineError ? err.stage : state.currentStage;

    log.error(`Pipeline failed at stage ${stage}: ${err.message}`);
    emit(requestId, "error", { stage, message: err.message });

    return { success: false, error: err.message, stage, state };
  }
}

// ─── Complete Delivery (stages 7+8) ──────────────────────────────────────────

/**
 * Called when delivery proof is submitted (via webhook or API).
 * Handles verification (stage 7) and settlement (stage 8).
 */
export async function completeDelivery(requestId, deliveryProof) {
  log.info(`Completing delivery for request #${requestId}`);

  const state = activePipelines.get(requestId);

  try {
    // ── Stage 7: Verify Delivery ──────────────────────────────────────
    emit(requestId, "receipt", { status: "started", message: "Verifying delivery proof..." });

    // The fulfiller has already called confirmDelivery on-chain.
    // Now the oracle verifies the proof.

    const { verifyDelivery: verifyDeliveryProof } = await import("./fulfillment.js");

    const onChainReq = await blockchain.getRequest(requestId);
    const verifyResult = await verifyDeliveryProof({
      deliveryType: onChainReq.fulfillerType,
      proofData: deliveryProof,
      targetLat: onChainReq.lat,
      targetLng: onChainReq.lng,
    });

    // Submit verification on-chain
    await blockchain.verifyDeliveryOnChain(
      requestId,
      verifyResult.verified,
      verifyResult.verificationHash
    );

    if (!verifyResult.verified) {
      emit(requestId, "receipt", {
        status: "failed",
        message: "Delivery verification failed",
        data: verifyResult,
      });
      return { success: false, reason: "Delivery verification failed" };
    }

    emit(requestId, "receipt", {
      status: "completed",
      message: "Delivery verified ✓",
      data: verifyResult.attestation,
    });

    // ── Stage 8: Settlement ───────────────────────────────────────────
    emit(requestId, "settlement", { status: "started", message: "Releasing payout..." });

    await blockchain.releasePayoutOnChain(requestId);

    emit(requestId, "settlement", {
      status: "completed",
      message: `Payout released — Contract settled ✓`,
    });

    // Clean up
    if (state) {
      state.stages.receipt = { completedAt: Date.now() };
      state.stages.settlement = { completedAt: Date.now() };
      state.currentStage = STAGES.SETTLEMENT;
    }
    activePipelines.delete(requestId);

    log.info(`═══ Pipeline complete for request #${requestId} ═══`);
    return { success: true };

  } catch (err) {
    log.error(`Delivery completion failed for #${requestId}: ${err.message}`);
    emit(requestId, "error", { stage: "delivery", message: err.message });
    return { success: false, error: err.message };
  }
}

// ─── Pipeline Queries ────────────────────────────────────────────────────────

export function getPipelineState(requestId) {
  return activePipelines.get(requestId) || null;
}

export function getActivePipelines() {
  return Array.from(activePipelines.entries()).map(([id, state]) => ({
    requestId: id,
    currentStage: state.currentStage,
    elapsed: Date.now() - state.startTime,
    error: state.error,
  }));
}

// ─── Error Class ─────────────────────────────────────────────────────────────

class PipelineError extends Error {
  constructor(stage, message) {
    super(message);
    this.stage = stage;
    this.name = "PipelineError";
  }
}
