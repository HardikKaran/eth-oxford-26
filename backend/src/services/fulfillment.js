import { ethers } from "ethers";
import { createServiceLogger } from "../utils/logger.js";
import config from "../config/index.js";

const log = createServiceLogger("fulfillment");

/**
 * Fulfillment Service
 *
 * Coordinates actual aid delivery through:
 *   - Zipline (drone delivery for medical, food, comms)
 *   - Local authorities (search & rescue, shelter, evacuation)
 *
 * Also handles delivery verification:
 *   - Drone: GPS coordinates at drop + camera image
 *   - Human: Authority digital signature
 */

// ─── Fulfiller Registry ──────────────────────────────────────────────────────
// In production, these come from the smart contract's approved fulfiller list

const FULFILLERS = {
  drone: {
    name: "Zipline",
    type: "drone",
    walletAddress: process.env.ZIPLINE_WALLET || "0x1234567890abcdef1234567890abcdef12345678",
    capabilities: ["medical", "food", "comms"],
    maxPayloadKg: 1.8,
    maxRangeKm: 80,
    avgSpeedKmh: 110,
  },
  authority: {
    name: "Local Emergency Services",
    type: "human",
    walletAddress: process.env.AUTHORITY_WALLET || "0xabcdef1234567890abcdef1234567890abcdef12",
    capabilities: ["shelter", "rescue", "evacuation", "medical", "food"],
    maxRangeKm: 500,
  },
};

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Dispatch a fulfiller for the given request.
 *
 * @param {Object} params
 * @param {number} params.requestId
 * @param {string} params.fulfillerType  - "drone" or "human"
 * @param {string} params.aidType        - The aid being delivered
 * @param {number} params.lat            - Delivery latitude
 * @param {number} params.lng            - Delivery longitude
 * @param {number} params.estimatedCost  - Estimated cost in USD
 * @returns {Promise<DispatchResult>}
 */
export async function dispatchFulfiller({ requestId, fulfillerType, aidType, lat, lng, estimatedCost }) {
  const fulfiller = fulfillerType === "drone" || fulfillerType === 0
    ? FULFILLERS.drone
    : FULFILLERS.authority;

  log.info(`Dispatching ${fulfiller.name} for request #${requestId} (${aidType})`);

  if (fulfiller.type === "drone") {
    return dispatchDrone({ requestId, aidType, lat, lng, fulfiller });
  } else {
    return dispatchAuthority({ requestId, aidType, lat, lng, fulfiller });
  }
}

// ─── Drone Dispatch (Zipline) ────────────────────────────────────────────────

async function dispatchDrone({ requestId, aidType, lat, lng, fulfiller }) {
  log.info(`Initiating Zipline drone dispatch for request #${requestId}`);

  if (config.env === "production" && config.ziplineApiUrl) {
    try {
      const response = await fetch(`${config.ziplineApiUrl}/deliveries`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.ZIPLINE_API_KEY}`,
        },
        body: JSON.stringify({
          deliveryType: mapAidToZiplineType(aidType),
          destination: { latitude: lat, longitude: lng },
          priority: "emergency",
          referenceId: `aidchain-${requestId}`,
          callbackUrl: `${process.env.API_BASE_URL}/api/webhooks/zipline`,
        }),
        signal: AbortSignal.timeout(15000),
      });

      const data = await response.json();

      return {
        success: true,
        fulfillerAddress: fulfiller.walletAddress,
        dispatchId: data.deliveryId || `ZPL-${requestId}`,
        droneId: data.droneId || null,
        estimatedEta: data.eta || null,
        status: "dispatched",
      };
    } catch (err) {
      log.error(`Zipline dispatch failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // Dev simulation
  const droneId = `ZPL-${4000 + Math.floor(Math.random() * 1000)}`;
  const distanceKm = 5 + Math.random() * 40;
  const etaMinutes = Math.round((distanceKm / fulfiller.avgSpeedKmh) * 60 + 5);

  log.info(`Drone ${droneId} assigned — ETA: ${etaMinutes} min`);

  return {
    success: true,
    fulfillerAddress: fulfiller.walletAddress,
    dispatchId: `dispatch-${requestId}-${Date.now()}`,
    droneId,
    estimatedEta: `${etaMinutes} minutes`,
    distanceKm: Math.round(distanceKm),
    status: "dispatched",
  };
}

// ─── Authority Dispatch ──────────────────────────────────────────────────────

async function dispatchAuthority({ requestId, aidType, lat, lng, fulfiller }) {
  log.info(`Initiating local authority dispatch for request #${requestId}`);

  // In production, this integrates with local emergency management systems
  // via APIs, SMS gateways, or radio dispatch systems.

  const teamId = `ESR-${100 + Math.floor(Math.random() * 900)}`;
  const etaMinutes = 30 + Math.floor(Math.random() * 90);

  log.info(`Team ${teamId} assigned — ETA: ${etaMinutes} min`);

  return {
    success: true,
    fulfillerAddress: fulfiller.walletAddress,
    dispatchId: `dispatch-${requestId}-${Date.now()}`,
    teamId,
    estimatedEta: `${etaMinutes} minutes`,
    status: "dispatched",
  };
}

// ─── Delivery Verification ───────────────────────────────────────────────────

/**
 * Verify that a delivery has been completed.
 *
 * Drone deliveries: verify GPS coordinates at drop match target + camera image
 * Human deliveries: verify authority digital signature
 *
 * @param {Object} params
 * @param {string} params.deliveryType   - "drone" or "human"
 * @param {Object} params.proofData      - Delivery proof data
 * @param {number} params.targetLat      - Expected delivery latitude
 * @param {number} params.targetLng      - Expected delivery longitude
 * @returns {Promise<VerificationResult>}
 */
export async function verifyDelivery({ deliveryType, proofData, targetLat, targetLng }) {
  log.info(`Verifying ${deliveryType} delivery`);

  if (deliveryType === "drone") {
    return verifyDroneDelivery(proofData, targetLat, targetLng);
  } else {
    return verifyAuthorityDelivery(proofData);
  }
}

async function verifyDroneDelivery(proofData, targetLat, targetLng) {
  const { dropLat, dropLng, cameraImageHash, droneId, timestamp } = proofData;

  // Check GPS proximity (drop location within 30m of target)
  const distance = haversineDistance(targetLat, targetLng, dropLat, dropLng);
  const gpsMatch = distance < 30;

  // Verify camera image exists and is valid
  const cameraValid = cameraImageHash && cameraImageHash !== ethers.ZeroHash;

  // Build verification attestation
  const attestation = {
    type: "drone",
    droneId,
    gpsMatch,
    gpsDistance: Math.round(distance * 10) / 10,
    cameraVerified: cameraValid,
    timestamp: timestamp || new Date().toISOString(),
    verified: gpsMatch && cameraValid,
  };

  const verificationHash = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify(attestation))
  );

  log.info(`Drone delivery verification: GPS=${gpsMatch} (${distance.toFixed(1)}m), Camera=${cameraValid}`);

  return {
    verified: attestation.verified,
    attestation,
    verificationHash,
  };
}

async function verifyAuthorityDelivery(proofData) {
  const { officerId, signature, timestamp } = proofData;

  // In production, verify the digital signature against a registry of
  // authorized emergency personnel.
  const signatureValid = signature && signature.length > 0;
  const officerValid = officerId && officerId.length > 0;

  const attestation = {
    type: "human",
    officerId,
    signatureValid,
    officerValid,
    timestamp: timestamp || new Date().toISOString(),
    verified: signatureValid && officerValid,
  };

  const verificationHash = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify(attestation))
  );

  log.info(`Authority delivery verification: signature=${signatureValid}, officer=${officerValid}`);

  return {
    verified: attestation.verified,
    attestation,
    verificationHash,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapAidToZiplineType(aidType) {
  const map = {
    medical: "MEDICAL_SUPPLY",
    food: "FOOD_PACKAGE",
    comms: "COMM_EQUIPMENT",
  };
  return map[aidType] || "GENERAL_SUPPLY";
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Get the wallet address of the appropriate fulfiller.
 */
export function getFulfillerAddress(fulfillerType) {
  if (fulfillerType === "drone" || fulfillerType === 0) {
    return FULFILLERS.drone.walletAddress;
  }
  return FULFILLERS.authority.walletAddress;
}
