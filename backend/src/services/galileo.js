import { ethers } from "ethers";
import { createServiceLogger } from "../utils/logger.js";
import config from "../config/index.js";

const log = createServiceLogger("galileo");

/**
 * Galileo OS-NMA Verification Service
 *
 * Galileo Open Service Navigation Message Authentication (OS-NMA) provides
 * cryptographic authentication of navigation signals. This service:
 *
 * 1. Receives raw GNSS data from the user's device
 * 2. Validates the OSNMA authentication chain
 * 3. Verifies signal integrity (anti-spoofing)
 * 4. Confirms time accuracy via TAI (International Atomic Time)
 * 5. Returns an authenticated location + time attestation
 *
 * In production, this integrates with a Galileo receiver or the GSA OSNMA
 * reference library. For development, we simulate the verification.
 */

// ─── OSNMA Verification Result ───────────────────────────────────────────────

/**
 * @typedef {Object} GalileoVerification
 * @property {boolean}  valid            - Whether the location is authenticated
 * @property {number}   lat              - Authenticated latitude
 * @property {number}   lng              - Authenticated longitude
 * @property {number}   accuracy         - Accuracy in meters
 * @property {number}   satelliteCount   - Number of Galileo satellites used
 * @property {boolean}  spoofingClear    - Anti-spoofing check passed
 * @property {boolean}  timeAuthenticated - TAI time is verified
 * @property {string}   timestamp        - ISO 8601 timestamp from Galileo TAI
 * @property {string}   proofHash        - Hash of the verification bundle
 * @property {Object}   rawSignalData    - Raw signal data for on-chain attestation
 */

// ─── Core Verification ───────────────────────────────────────────────────────

/**
 * Verify a location claim using Galileo OS-NMA.
 *
 * @param {Object} params
 * @param {number} params.claimedLat   - User's claimed latitude
 * @param {number} params.claimedLng   - User's claimed longitude
 * @param {Object} params.gnssData     - Raw GNSS data from user's device
 * @param {string} params.deviceId     - Device identifier
 * @returns {Promise<GalileoVerification>}
 */
export async function verifyLocation({ claimedLat, claimedLng, gnssData, deviceId }) {
  log.info(`Verifying location: ${claimedLat}, ${claimedLng} (device: ${deviceId})`);

  try {
    // ── Step 1: Acquire Galileo satellite signals ──────────────────────
    const satellites = await acquireSatellites(gnssData);
    log.debug(`Acquired ${satellites.length} Galileo satellites`);

    if (satellites.length < 4) {
      return createFailedResult("Insufficient satellite coverage", claimedLat, claimedLng);
    }

    // ── Step 2: Validate OSNMA authentication chain ────────────────────
    const osnmaValid = await validateOSNMA(satellites, gnssData);
    if (!osnmaValid) {
      return createFailedResult("OSNMA authentication failed", claimedLat, claimedLng);
    }

    // ── Step 3: Anti-spoofing analysis ─────────────────────────────────
    const spoofingCheck = await checkForSpoofing(satellites, gnssData);
    if (!spoofingCheck.clear) {
      log.warn(`Spoofing detected for device ${deviceId}: ${spoofingCheck.reason}`);
      return createFailedResult(`Spoofing detected: ${spoofingCheck.reason}`, claimedLat, claimedLng);
    }

    // ── Step 4: Compute authenticated position ────────────────────────
    const position = computePosition(satellites);

    // ── Step 5: Verify claimed position matches authenticated position ─
    const distance = haversineDistance(
      claimedLat, claimedLng,
      position.lat, position.lng
    );

    // Allow up to 50m discrepancy (accounts for device GPS noise)
    if (distance > 50) {
      log.warn(`Position mismatch: claimed vs authenticated = ${distance.toFixed(1)}m`);
      return createFailedResult("Position mismatch exceeds tolerance", claimedLat, claimedLng);
    }

    // ── Step 6: TAI time verification ──────────────────────────────────
    const galileoTime = await getAuthenticatedTime(satellites);

    // ── Step 7: Build proof bundle ─────────────────────────────────────
    const proofBundle = {
      authenticatedLat: position.lat,
      authenticatedLng: position.lng,
      accuracy: position.accuracy,
      satelliteCount: satellites.length,
      satellitePRNs: satellites.map((s) => s.prn),
      osnmaKeyId: osnmaValid.keyId || "OSNMA-KEY-2026",
      spoofingClear: true,
      taiTimestamp: galileoTime.tai,
      utcTimestamp: galileoTime.utc,
      deviceId,
    };

    const proofHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(proofBundle))
    );

    log.info(`Location verified: ${position.lat.toFixed(6)}, ${position.lng.toFixed(6)} ±${position.accuracy}m | proof=${proofHash.slice(0, 18)}...`);

    return {
      valid: true,
      lat: position.lat,
      lng: position.lng,
      accuracy: position.accuracy,
      satelliteCount: satellites.length,
      spoofingClear: true,
      timeAuthenticated: true,
      timestamp: galileoTime.utc,
      proofHash,
      rawSignalData: proofBundle,
    };
  } catch (err) {
    log.error(`Galileo verification error: ${err.message}`);
    return createFailedResult(err.message, claimedLat, claimedLng);
  }
}

// ─── Satellite Acquisition ───────────────────────────────────────────────────

async function acquireSatellites(gnssData) {
  // Production: parse raw GNSS observables, identify Galileo (E1/E5) signals
  // Dev: simulate satellite acquisition

  if (config.env === "production" && config.galileoEndpoint) {
    // Call actual Galileo receiver API
    const response = await fetch(`${config.galileoEndpoint}/acquire`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gnssData }),
    });
    return response.json();
  }

  // Simulated satellite data
  return [
    { prn: "E01", signal: "E1-B", cnr: 42.5, elevation: 65, azimuth: 120, osnmaStatus: "authenticated" },
    { prn: "E04", signal: "E1-B", cnr: 38.2, elevation: 45, azimuth: 230, osnmaStatus: "authenticated" },
    { prn: "E09", signal: "E1-B", cnr: 40.1, elevation: 55, azimuth: 340, osnmaStatus: "authenticated" },
    { prn: "E12", signal: "E1-B", cnr: 36.8, elevation: 30, azimuth: 80, osnmaStatus: "authenticated" },
    { prn: "E19", signal: "E1-B", cnr: 44.0, elevation: 70, azimuth: 190, osnmaStatus: "authenticated" },
    { prn: "E24", signal: "E1-B", cnr: 39.5, elevation: 50, azimuth: 310, osnmaStatus: "authenticated" },
    { prn: "E26", signal: "E1-B", cnr: 41.3, elevation: 60, azimuth: 160, osnmaStatus: "authenticated" },
    { prn: "E31", signal: "E1-B", cnr: 37.9, elevation: 35, azimuth: 270, osnmaStatus: "authenticated" },
  ];
}

// ─── OSNMA Validation ────────────────────────────────────────────────────────

async function validateOSNMA(satellites, gnssData) {
  // Production: validate the TESLA key chain, verify MACK (Message
  // Authentication Code with Key) for each satellite's navigation data.
  // Uses the OSNMA public key from the Galileo ICD.

  if (config.env === "production" && config.galileoEndpoint) {
    const response = await fetch(`${config.galileoEndpoint}/validate-osnma`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ satellites, gnssData }),
    });
    return response.json();
  }

  // Dev: check that all satellites report authenticated OSNMA status
  const allAuthenticated = satellites.every((s) => s.osnmaStatus === "authenticated");
  return allAuthenticated ? { valid: true, keyId: "OSNMA-TESLA-2026-Q1" } : false;
}

// ─── Anti-Spoofing ───────────────────────────────────────────────────────────

async function checkForSpoofing(satellites, gnssData) {
  // Production checks:
  //   1. Signal power consistency (spoofed signals often have uniform power)
  //   2. Doppler shift consistency with satellite ephemeris
  //   3. Code-carrier divergence monitoring
  //   4. OSNMA authentication (already done above — belt and suspenders)
  //   5. Cross-constellation consistency (compare with GPS if available)

  // Check for suspicious signal power uniformity
  const cnrValues = satellites.map((s) => s.cnr);
  const cnrStdDev = standardDeviation(cnrValues);

  if (cnrStdDev < 0.5) {
    // Too uniform — likely spoofed
    return { clear: false, reason: "Suspicious signal power uniformity" };
  }

  // Check elevation-CNR correlation (higher elevation → generally stronger)
  // A simple sanity check; production uses more sophisticated models
  const highElev = satellites.filter((s) => s.elevation > 50);
  const lowElev = satellites.filter((s) => s.elevation <= 50);

  if (highElev.length > 0 && lowElev.length > 0) {
    const highAvgCnr = average(highElev.map((s) => s.cnr));
    const lowAvgCnr = average(lowElev.map((s) => s.cnr));

    // High-elevation signals should generally be stronger
    if (lowAvgCnr > highAvgCnr + 5) {
      return { clear: false, reason: "Elevation-CNR correlation anomaly" };
    }
  }

  return { clear: true };
}

// ─── Position Computation ────────────────────────────────────────────────────

function computePosition(satellites) {
  // Production: least-squares or Kalman filter position solution from
  // pseudorange measurements. For dev, return simulated position.

  // In a real implementation, this would use the authenticated navigation
  // data (validated by OSNMA) to compute a trustworthy position.

  return {
    lat: satellites[0]?.lat || -17.0523,
    lng: satellites[0]?.lng || 36.8714,
    altitude: 45.2,
    accuracy: 2.1, // meters
  };
}

// ─── Authenticated Time ──────────────────────────────────────────────────────

async function getAuthenticatedTime(satellites) {
  // Galileo provides TAI (International Atomic Time) through its navigation
  // message. OSNMA ensures this time data is authentic.

  const now = new Date();
  return {
    tai: now.toISOString(), // In production, derived from Galileo signal
    utc: now.toISOString(),
    leapSeconds: 37,
  };
}

// ─── Math Helpers ────────────────────────────────────────────────────────────

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function standardDeviation(arr) {
  const avg = average(arr);
  const squareDiffs = arr.map((v) => (v - avg) ** 2);
  return Math.sqrt(average(squareDiffs));
}

function createFailedResult(reason, lat, lng) {
  return {
    valid: false,
    reason,
    lat, lng,
    accuracy: null,
    satelliteCount: 0,
    spoofingClear: false,
    timeAuthenticated: false,
    timestamp: new Date().toISOString(),
    proofHash: ethers.ZeroHash,
    rawSignalData: null,
  };
}
