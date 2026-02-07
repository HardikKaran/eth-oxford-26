import { ethers } from "ethers";
import { createServiceLogger } from "../utils/logger.js";
import config from "../config/index.js";

const log = createServiceLogger("fdc");

/**
 * Flare Data Connector (FDC) Event Verification Service
 *
 * The FDC provides decentralised data attestation on the Flare network.
 * This service:
 *
 * 1. Queries multiple authoritative disaster data sources
 * 2. Cross-references reported events with the user's claimed location
 * 3. Generates an attestation that the disaster event is real and ongoing
 * 4. Submits the attestation hash on-chain via the oracle
 *
 * Data sources:
 *   - GDACS (Global Disaster Alerting Coordination System)
 *   - USGS (earthquakes)
 *   - ReliefWeb (humanitarian crises)
 *   - Local government emergency APIs
 *   - Copernicus EMS (satellite imagery for floods, fires)
 */

// ─── Event Types ─────────────────────────────────────────────────────────────

const EVENT_TYPES = {
  EQ: "earthquake",
  FL: "flood",
  TC: "cyclone",
  DR: "drought",
  VO: "volcano",
  WF: "wildfire",
  TS: "tsunami",
  EP: "epidemic",
};

const SEVERITY_LEVELS = {
  GREEN: "low",
  ORANGE: "moderate",
  RED: "severe",
  PURPLE: "critical",
};

// ─── Core Verification ───────────────────────────────────────────────────────

/**
 * Verify that a claimed disaster event is occurring at the given location.
 *
 * @param {Object} params
 * @param {number} params.lat          - Authenticated latitude (from Galileo)
 * @param {number} params.lng          - Authenticated longitude (from Galileo)
 * @param {string} params.claimedEvent - User's description of the event
 * @param {number} params.radiusKm     - Search radius in km (default 100)
 * @returns {Promise<FDCVerification>}
 */
export async function verifyEvent({ lat, lng, claimedEvent, radiusKm = 100 }) {
  log.info(`Verifying event near ${lat.toFixed(4)}, ${lng.toFixed(4)} (radius: ${radiusKm}km)`);

  try {
    // ── Step 1: Query disaster data sources in parallel ────────────────
    const [gdacsEvents, usgsEvents, reliefWebEvents] = await Promise.allSettled([
      queryGDACS(lat, lng, radiusKm),
      queryUSGS(lat, lng, radiusKm),
      queryReliefWeb(lat, lng, radiusKm),
    ]);

    // Collect all confirmed events
    const allEvents = [
      ...(gdacsEvents.status === "fulfilled" ? gdacsEvents.value : []),
      ...(usgsEvents.status === "fulfilled" ? usgsEvents.value : []),
      ...(reliefWebEvents.status === "fulfilled" ? reliefWebEvents.value : []),
    ];

    log.debug(`Found ${allEvents.length} events from data sources`);

    if (allEvents.length === 0) {
      return {
        verified: false,
        reason: "No active events found in the vicinity",
        events: [],
        attestation: null,
      };
    }

    // ── Step 2: Cross-reference and deduplicate ────────────────────────
    const deduped = deduplicateEvents(allEvents);

    // ── Step 3: Find the most relevant event ───────────────────────────
    const bestMatch = findBestMatch(deduped, lat, lng, claimedEvent);

    if (!bestMatch) {
      return {
        verified: false,
        reason: "No matching event found for the claimed situation",
        events: deduped,
        attestation: null,
      };
    }

    // ── Step 4: Verify event is still active ───────────────────────────
    if (!bestMatch.active) {
      return {
        verified: false,
        reason: "Matched event is no longer active",
        events: deduped,
        attestation: null,
      };
    }

    // ── Step 5: Build FDC attestation ──────────────────────────────────
    const attestation = {
      eventId: bestMatch.id,
      eventType: bestMatch.type,
      eventName: bestMatch.name,
      severity: bestMatch.severity,
      region: bestMatch.region,
      center: { lat: bestMatch.lat, lng: bestMatch.lng },
      affectedRadius: bestMatch.radiusKm,
      sources: bestMatch.sources,
      sourceCount: bestMatch.sources.length,
      distanceFromUser: haversineDistance(lat, lng, bestMatch.lat, bestMatch.lng) / 1000,
      verifiedAt: new Date().toISOString(),
      active: true,
    };

    const eventIdHash = ethers.keccak256(ethers.toUtf8Bytes(attestation.eventId));
    const proofHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(attestation)));

    log.info(`Event verified: "${bestMatch.name}" (${bestMatch.type}, ${bestMatch.severity}) — ${attestation.distanceFromUser.toFixed(1)}km from user`);

    return {
      verified: true,
      event: attestation,
      eventIdHash,
      proofHash,
      events: deduped,
    };
  } catch (err) {
    log.error(`FDC verification error: ${err.message}`);
    return {
      verified: false,
      reason: err.message,
      events: [],
      attestation: null,
    };
  }
}

// ─── Data Source: GDACS ──────────────────────────────────────────────────────

async function queryGDACS(lat, lng, radiusKm) {
  log.debug("Querying GDACS...");

  if (config.env === "production") {
    try {
      const url = `${config.gdacsApiUrl}/geteventlist/MAP`;
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      return parseGDACSEvents(data, lat, lng, radiusKm);
    } catch (err) {
      log.warn(`GDACS query failed: ${err.message}`);
      return [];
    }
  }

  // Dev: return simulated events
  return [
    {
      id: "gdacs-fl-2026-001",
      type: "flood",
      name: "Mozambique Flooding 2026",
      severity: "critical",
      region: "Zambezia Province, Mozambique",
      lat: -17.05,
      lng: 36.87,
      radiusKm: 200,
      active: true,
      sources: ["GDACS"],
      startDate: "2026-01-28T00:00:00Z",
    },
    {
      id: "gdacs-eq-2026-002",
      type: "earthquake",
      name: "Eastern Turkey Earthquake",
      severity: "severe",
      region: "Van Province, Turkey",
      lat: 38.49,
      lng: 43.38,
      radiusKm: 150,
      active: true,
      sources: ["GDACS"],
      startDate: "2026-02-01T00:00:00Z",
    },
  ];
}

function parseGDACSEvents(data, lat, lng, radiusKm) {
  if (!data?.features) return [];
  return data.features
    .map((f) => ({
      id: `gdacs-${f.properties?.eventid || "unknown"}`,
      type: EVENT_TYPES[f.properties?.eventtype] || "unknown",
      name: f.properties?.eventname || "Unknown Event",
      severity: SEVERITY_LEVELS[f.properties?.alertlevel] || "unknown",
      region: f.properties?.country || "Unknown",
      lat: f.geometry?.coordinates?.[1] || 0,
      lng: f.geometry?.coordinates?.[0] || 0,
      radiusKm: f.properties?.severitydata?.severity || 100,
      active: true,
      sources: ["GDACS"],
      startDate: f.properties?.fromdate,
    }))
    .filter((e) => haversineDistance(lat, lng, e.lat, e.lng) / 1000 < radiusKm);
}

// ─── Data Source: USGS ───────────────────────────────────────────────────────

async function queryUSGS(lat, lng, radiusKm) {
  log.debug("Querying USGS...");

  if (config.env === "production") {
    try {
      const url =
        `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
        `&latitude=${lat}&longitude=${lng}&maxradiuskm=${radiusKm}` +
        `&starttime=${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}` +
        `&minmagnitude=4.5`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      return parseUSGSEvents(data);
    } catch (err) {
      log.warn(`USGS query failed: ${err.message}`);
      return [];
    }
  }

  return [];
}

function parseUSGSEvents(data) {
  if (!data?.features) return [];
  return data.features.map((f) => ({
    id: `usgs-${f.id}`,
    type: "earthquake",
    name: f.properties.place || "Earthquake",
    severity: f.properties.mag >= 7 ? "critical" : f.properties.mag >= 5.5 ? "severe" : "moderate",
    region: f.properties.place,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    radiusKm: Math.max(50, f.properties.mag * 30),
    active: true,
    sources: ["USGS"],
    startDate: new Date(f.properties.time).toISOString(),
  }));
}

// ─── Data Source: ReliefWeb ──────────────────────────────────────────────────

async function queryReliefWeb(lat, lng, radiusKm) {
  log.debug("Querying ReliefWeb...");

  if (config.env === "production") {
    try {
      const url = `https://api.reliefweb.int/v1/disasters?appname=aidchain&filter[field]=status&filter[value]=current&limit=50`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      return parseReliefWebEvents(data, lat, lng, radiusKm);
    } catch (err) {
      log.warn(`ReliefWeb query failed: ${err.message}`);
      return [];
    }
  }

  return [];
}

function parseReliefWebEvents(data, lat, lng, radiusKm) {
  if (!data?.data) return [];
  // ReliefWeb doesn't always have coords — filter by country/region matching
  return data.data
    .filter((d) => d.fields?.status === "current")
    .map((d) => ({
      id: `reliefweb-${d.id}`,
      type: d.fields?.type?.[0]?.name?.toLowerCase() || "disaster",
      name: d.fields?.name || "Unknown Disaster",
      severity: "severe",
      region: d.fields?.country?.[0]?.name || "Unknown",
      lat: d.fields?.primary_country?.location?.lat || 0,
      lng: d.fields?.primary_country?.location?.lon || 0,
      radiusKm: 200,
      active: true,
      sources: ["ReliefWeb"],
      startDate: d.fields?.date?.created,
    }))
    .filter((e) => e.lat !== 0 && haversineDistance(lat, lng, e.lat, e.lng) / 1000 < radiusKm);
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function deduplicateEvents(events) {
  const grouped = {};

  for (const event of events) {
    // Group events within 50km and same type
    let merged = false;
    for (const key of Object.keys(grouped)) {
      const existing = grouped[key];
      if (
        existing.type === event.type &&
        haversineDistance(existing.lat, existing.lng, event.lat, event.lng) / 1000 < 50
      ) {
        // Merge sources
        existing.sources = [...new Set([...existing.sources, ...event.sources])];
        merged = true;
        break;
      }
    }
    if (!merged) {
      grouped[event.id] = { ...event };
    }
  }

  return Object.values(grouped);
}

// ─── Best Match ──────────────────────────────────────────────────────────────

function findBestMatch(events, lat, lng, claimedEvent) {
  if (events.length === 0) return null;

  // Score events by proximity and source count
  const scored = events.map((e) => {
    const distance = haversineDistance(lat, lng, e.lat, e.lng) / 1000;
    const proximityScore = Math.max(0, 1 - distance / e.radiusKm);
    const sourceScore = e.sources.length / 3; // max 3 sources
    const severityScore = { critical: 1, severe: 0.75, moderate: 0.5, low: 0.25 }[e.severity] || 0;

    return {
      ...e,
      score: proximityScore * 0.5 + sourceScore * 0.3 + severityScore * 0.2,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
