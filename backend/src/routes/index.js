import { Router } from "express";
import { ethers } from "ethers";
import { authenticate, generateToken } from "../middleware/auth.js";
import { executePipeline, completeDelivery, getPipelineState, getActivePipelines } from "../services/pipeline.js";
import * as blockchain from "../services/blockchain.js";
import { createServiceLogger } from "../utils/logger.js";

const log = createServiceLogger("api");

// ─── Aid Requests ────────────────────────────────────────────────────────────

export const requestsRouter = Router();

/**
 * POST /api/requests
 * Submit a new aid request and trigger the full pipeline.
 *
 * Body: { aidType, urgency, lat, lng, details, gnssData, deviceId }
 */
requestsRouter.post("/", authenticate, async (req, res) => {
  try {
    const { aidType, urgency, lat, lng, details, gnssData, deviceId } = req.body;

    // Validate inputs
    if (aidType === undefined || urgency === undefined || !lat || !lng) {
      return res.status(400).json({ error: "Missing required fields: aidType, urgency, lat, lng" });
    }

    const AID_TYPES = ["medical", "food", "shelter", "rescue", "comms", "evacuation"];
    const aidTypeIndex = typeof aidType === "string" ? AID_TYPES.indexOf(aidType) : aidType;
    if (aidTypeIndex < 0 || aidTypeIndex > 5) {
      return res.status(400).json({ error: "Invalid aid type" });
    }

    const urgencyMap = { medium: 0, high: 1, critical: 2 };
    const urgencyIndex = typeof urgency === "string" ? urgencyMap[urgency] : urgency;
    if (urgencyIndex === undefined || urgencyIndex > 2) {
      return res.status(400).json({ error: "Invalid urgency level" });
    }

    log.info(`New aid request from ${req.user.address}: ${AID_TYPES[aidTypeIndex]}, urgency=${urgency}`);

    // The on-chain requestAid() is called by the user's wallet directly.
    // Here we retrieve the request ID from the event or use a pending approach.
    // For the orchestrator, we use the next expected request ID.
    const requestCount = await blockchain.getRequestCount();
    const requestId = requestCount; // Next ID to be created

    // Execute the pipeline asynchronously
    const pipelinePromise = executePipeline({
      requestId,
      aidType: AID_TYPES[aidTypeIndex],
      urgency: Object.keys(urgencyMap).find(k => urgencyMap[k] === urgencyIndex) || "high",
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      details: details || "",
      gnssData: gnssData || {},
      deviceId: deviceId || req.user.deviceId || "unknown",
    });

    // Return immediately with request ID; client polls or uses WebSocket
    res.status(202).json({
      requestId,
      status: "pipeline_started",
      message: "Aid request accepted — pipeline executing",
      pipelineUrl: `/api/requests/${requestId}/pipeline`,
    });

    // Pipeline runs in background
    pipelinePromise.catch((err) => {
      log.error(`Background pipeline error for #${requestId}: ${err.message}`);
    });

  } catch (err) {
    log.error(`Request submission error: ${err.message}`);
    res.status(500).json({ error: "Failed to process request", details: err.message });
  }
});

/**
 * GET /api/requests/:id
 * Get the on-chain state of a request.
 */
requestsRouter.get("/:id", async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const request = await blockchain.getRequest(requestId);
    res.json(request);
  } catch (err) {
    res.status(404).json({ error: "Request not found", details: err.message });
  }
});

/**
 * GET /api/requests/:id/pipeline
 * Get the current pipeline execution state.
 */
requestsRouter.get("/:id/pipeline", (req, res) => {
  const requestId = parseInt(req.params.id);
  const state = getPipelineState(requestId);

  if (!state) {
    return res.json({ requestId, status: "not_active", message: "No active pipeline for this request" });
  }

  res.json({
    requestId,
    currentStage: state.currentStage,
    elapsed: Date.now() - state.startTime,
    stages: state.stages,
    error: state.error,
  });
});

/**
 * GET /api/requests/user/:address
 * Get all request IDs for a user.
 */
requestsRouter.get("/user/:address", async (req, res) => {
  try {
    const ids = await blockchain.getUserRequests(req.params.address);
    res.json({ address: req.params.address, requestIds: ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delivery Confirmation ───────────────────────────────────────────────────

export const deliveryRouter = Router();

/**
 * POST /api/delivery/confirm
 * Fulfiller confirms delivery with proof.
 *
 * Body (drone):    { requestId, dropLat, dropLng, cameraImageHash, droneId }
 * Body (human):    { requestId, officerId, signature }
 */
deliveryRouter.post("/confirm", authenticate, async (req, res) => {
  try {
    const { requestId, ...proofData } = req.body;

    if (requestId === undefined) {
      return res.status(400).json({ error: "requestId is required" });
    }

    log.info(`Delivery confirmation received for request #${requestId}`);

    const result = await completeDelivery(parseInt(requestId), proofData);

    if (result.success) {
      res.json({ status: "settled", message: "Delivery verified and payout released" });
    } else {
      res.status(400).json({ status: "failed", message: result.reason || result.error });
    }
  } catch (err) {
    log.error(`Delivery confirmation error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Fund Pool ───────────────────────────────────────────────────────────────

export const fundRouter = Router();

/**
 * GET /api/fund/stats
 * Get current fund pool statistics.
 */
fundRouter.get("/stats", async (req, res) => {
  try {
    const stats = await blockchain.getPoolStats();
    res.json(stats);
  } catch (err) {
    // Return mock data if contract isn't connected
    res.json({
      totalDeposited: "2450000.00",
      totalEscrowed: "87500.00",
      totalPaidOut: "1120340.00",
      availableBalance: "1242160.00",
    });
  }
});

// ─── Pipeline Status ─────────────────────────────────────────────────────────

export const pipelineRouter = Router();

/**
 * GET /api/pipeline/active
 * List all currently active pipelines.
 */
pipelineRouter.get("/active", (req, res) => {
  res.json(getActivePipelines());
});

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authRouter = Router();

/**
 * POST /api/auth/login
 * Authenticate with a wallet signature and get a JWT.
 *
 * Body: { address, signature, message }
 */
authRouter.post("/login", async (req, res) => {
  try {
    const { address, signature, message } = req.body;

    if (!address || !signature || !message) {
      return res.status(400).json({ error: "address, signature, and message are required" });
    }

    // Verify the signature
    const recoveredAddress = ethers.verifyMessage(message, signature);

    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Check if identity is verified on-chain
    let verified = false;
    try {
      verified = await blockchain.isIdentityVerified(address);
    } catch {
      // Registry might not be connected
    }

    const token = generateToken(address, verified);

    res.json({
      token,
      address,
      verified,
      expiresIn: "24h",
    });
  } catch (err) {
    log.error(`Auth error: ${err.message}`);
    res.status(500).json({ error: "Authentication failed" });
  }
});

/**
 * POST /api/auth/dev-token
 * Development only: get a token without signature verification.
 */
authRouter.post("/dev-token", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Not available in production" });
  }

  const { address } = req.body;
  const token = generateToken(address || "0x" + "1".repeat(40), true, "dev-device");
  res.json({ token, address, verified: true });
});

// ─── Webhooks (from external services) ───────────────────────────────────────

export const webhookRouter = Router();

/**
 * POST /api/webhooks/zipline
 * Callback from Zipline when delivery status changes.
 */
webhookRouter.post("/zipline", async (req, res) => {
  try {
    const { deliveryId, status, dropLocation, cameraProof, droneId } = req.body;

    log.info(`Zipline webhook: ${deliveryId} → ${status}`);

    if (status === "delivered" && dropLocation) {
      // Extract request ID from reference
      const requestIdMatch = deliveryId?.match(/aidchain-(\d+)/);
      if (requestIdMatch) {
        const requestId = parseInt(requestIdMatch[1]);
        await completeDelivery(requestId, {
          dropLat: dropLocation.latitude,
          dropLng: dropLocation.longitude,
          cameraImageHash: cameraProof?.hash || ethers.ZeroHash,
          droneId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    res.json({ received: true });
  } catch (err) {
    log.error(`Zipline webhook error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});
