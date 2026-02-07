import { ethers } from "ethers";
import config from "../config/index.js";
import { createServiceLogger } from "../utils/logger.js";

const log = createServiceLogger("blockchain");

// ─── ABI fragments (only the functions we call) ──────────────────────────────
// In production, import full ABIs from compiled artifacts.

const AIDCHAIN_ABI = [
  "function requestAid(uint8 aidType, uint8 urgency, int64 lat, int64 lng, bytes32 detailsHash) returns (uint256)",
  "function verifyRequest(uint256 requestId, bytes32 galileoProofHash, bytes32 fdcEventId, bytes32 fdcProofHash)",
  "function submitConsensus(uint256 requestId, bool approved, uint8 recommendedAid, uint8 fulfillerType, uint256 estimatedCostUSD, bytes32 consensusHash, uint8 nodeCount, uint8 approvalCount)",
  "function assignFulfiller(uint256 requestId, address fulfiller)",
  "function confirmDelivery(uint256 requestId, bytes32 deliveryHash, int64 deliveryLat, int64 deliveryLng)",
  "function verifyDelivery(uint256 requestId, bool verified, bytes32 verificationHash)",
  "function releasePayout(uint256 requestId)",
  "function timeoutRequest(uint256 requestId)",
  "function getRequest(uint256 requestId) view returns (tuple(uint256 id, address requester, uint8 aidType, uint8 urgency, int64 lat, int64 lng, bytes32 detailsHash, uint8 status, uint256 createdAt, bytes32 galileoProofHash, bytes32 fdcEventId, bytes32 fdcProofHash, uint256 verifiedAt, bytes32 consensusHash, uint8 recommendedAid, uint8 fulfillerType, uint256 estimatedCostUSD, address fulfiller, uint256 escrowAmount, uint256 fundedAt, bytes32 deliveryProofHash, int64 deliveryLat, int64 deliveryLng, uint256 deliveredAt, bytes32 deliveryVerificationHash, uint256 settledAt))",
  "function getUserRequests(address user) view returns (uint256[])",
  "function getRequestCount() view returns (uint256)",
  "event AidRequested(uint256 indexed requestId, address indexed requester, uint8 aidType, uint8 urgency)",
  "event RequestVerified(uint256 indexed requestId, bytes32 galileoProofHash, bytes32 fdcEventId)",
  "event ConsensusSubmitted(uint256 indexed requestId, bool approved, uint8 recommendedAid, uint256 estimatedCostUSD)",
  "event FulfillerAssigned(uint256 indexed requestId, address indexed fulfiller, uint256 escrowAmount)",
  "event DeliveryConfirmed(uint256 indexed requestId, bytes32 deliveryHash)",
  "event DeliveryVerified(uint256 indexed requestId, bool verified, bytes32 verificationHash)",
  "event PayoutReleased(uint256 indexed requestId, address indexed fulfiller, uint256 amount)",
];

const FUNDPOOL_ABI = [
  "function deposit(uint256 amount, bytes32 swapTxHash)",
  "function getPoolStats() view returns (uint256, uint256, uint256, uint256)",
  "function getDepositCount() view returns (uint256)",
];

const REGISTRY_ABI = [
  "function isIdentityVerified(address user) view returns (bool)",
  "function getIdentity(address user) view returns (tuple(bool verified, bytes32 nullifierHash, bytes32 proofHash, uint256 verifiedAt, uint256 expiresAt, bool revoked))",
];

// ─── Initialization ──────────────────────────────────────────────────────────

let provider;
let oracleSigner;
let aidChainContract;
let fundPoolContract;
let registryContract;

export function initBlockchain() {
  provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);

  if (config.oraclePrivateKey) {
    oracleSigner = new ethers.Wallet(config.oraclePrivateKey, provider);
    log.info(`Oracle signer: ${oracleSigner.address}`);
  } else {
    log.warn("No oracle private key configured — write operations disabled");
  }

  if (config.contracts.aidChain) {
    aidChainContract = new ethers.Contract(
      config.contracts.aidChain,
      AIDCHAIN_ABI,
      oracleSigner || provider
    );
    log.info(`AidChain contract: ${config.contracts.aidChain}`);
  }

  if (config.contracts.fundPool) {
    fundPoolContract = new ethers.Contract(
      config.contracts.fundPool,
      FUNDPOOL_ABI,
      oracleSigner || provider
    );
  }

  if (config.contracts.registry) {
    registryContract = new ethers.Contract(
      config.contracts.registry,
      REGISTRY_ABI,
      provider
    );
  }

  return { provider, oracleSigner, aidChainContract, fundPoolContract, registryContract };
}

// ─── Read Operations ─────────────────────────────────────────────────────────

export async function getRequest(requestId) {
  if (!aidChainContract) throw new Error("AidChain contract not initialized");
  const raw = await aidChainContract.getRequest(requestId);
  return formatRequest(raw);
}

export async function getUserRequests(userAddress) {
  if (!aidChainContract) throw new Error("AidChain contract not initialized");
  const ids = await aidChainContract.getUserRequests(userAddress);
  return ids.map((id) => Number(id));
}

export async function getRequestCount() {
  if (!aidChainContract) throw new Error("AidChain contract not initialized");
  return Number(await aidChainContract.getRequestCount());
}

export async function getPoolStats() {
  if (!fundPoolContract) throw new Error("FundPool contract not initialized");
  const [deposited, escrowed, paidOut, available] = await fundPoolContract.getPoolStats();
  return {
    totalDeposited: ethers.formatUnits(deposited, 6),
    totalEscrowed: ethers.formatUnits(escrowed, 6),
    totalPaidOut: ethers.formatUnits(paidOut, 6),
    availableBalance: ethers.formatUnits(available, 6),
  };
}

export async function isIdentityVerified(userAddress) {
  if (!registryContract) throw new Error("Registry contract not initialized");
  return registryContract.isIdentityVerified(userAddress);
}

// ─── Write Operations (oracle signer) ────────────────────────────────────────

export async function submitVerification(requestId, galileoProofHash, fdcEventId, fdcProofHash) {
  log.info(`Submitting verification for request ${requestId}`);
  const tx = await aidChainContract.verifyRequest(requestId, galileoProofHash, fdcEventId, fdcProofHash);
  const receipt = await tx.wait();
  log.info(`Verification tx: ${receipt.hash}`);
  return receipt;
}

export async function submitConsensusOnChain(requestId, approved, recommendedAid, fulfillerType, estimatedCostUSD, consensusHash, nodeCount, approvalCount) {
  log.info(`Submitting consensus for request ${requestId}: approved=${approved}`);
  const costInUnits = ethers.parseUnits(estimatedCostUSD.toString(), 6);
  const tx = await aidChainContract.submitConsensus(
    requestId, approved, recommendedAid, fulfillerType, costInUnits, consensusHash, nodeCount, approvalCount
  );
  const receipt = await tx.wait();
  log.info(`Consensus tx: ${receipt.hash}`);
  return receipt;
}

export async function assignFulfillerOnChain(requestId, fulfillerAddress) {
  log.info(`Assigning fulfiller ${fulfillerAddress} to request ${requestId}`);
  const tx = await aidChainContract.assignFulfiller(requestId, fulfillerAddress);
  const receipt = await tx.wait();
  log.info(`Assignment tx: ${receipt.hash}`);
  return receipt;
}

export async function verifyDeliveryOnChain(requestId, verified, verificationHash) {
  log.info(`Verifying delivery for request ${requestId}: verified=${verified}`);
  const tx = await aidChainContract.verifyDelivery(requestId, verified, verificationHash);
  const receipt = await tx.wait();
  log.info(`Delivery verification tx: ${receipt.hash}`);
  return receipt;
}

export async function releasePayoutOnChain(requestId) {
  log.info(`Releasing payout for request ${requestId}`);
  const tx = await aidChainContract.releasePayout(requestId);
  const receipt = await tx.wait();
  log.info(`Payout tx: ${receipt.hash}`);
  return receipt;
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

export function listenToEvents(callbacks) {
  if (!aidChainContract) return;

  let lastBlock = 0;

  async function pollEvents() {
    try {
      const currentBlock = await provider.getBlockNumber();
      if (lastBlock === 0) {
        lastBlock = currentBlock;
        return;
      }
      if (currentBlock <= lastBlock) return;

      const fromBlock = lastBlock + 1;
      const toBlock = currentBlock;
      lastBlock = currentBlock;

      const requestedEvents = await aidChainContract.queryFilter("AidRequested", fromBlock, toBlock);
      for (const event of requestedEvents) {
        const [requestId, requester, aidType, urgency] = event.args;
        log.info(`Event: AidRequested #${requestId} by ${requester}`);
        callbacks.onAidRequested?.({ requestId: Number(requestId), requester, aidType, urgency });
      }

      const payoutEvents = await aidChainContract.queryFilter("PayoutReleased", fromBlock, toBlock);
      for (const event of payoutEvents) {
        const [requestId, fulfiller, amount] = event.args;
        log.info(`Event: PayoutReleased #${requestId} → ${fulfiller} (${ethers.formatUnits(amount, 6)} USDC)`);
        callbacks.onPayoutReleased?.({ requestId: Number(requestId), fulfiller, amount: ethers.formatUnits(amount, 6) });
      }
    } catch (err) {
      log.debug(`Event poll error: ${err.message}`);
    }
  }

  setInterval(pollEvents, 10000);
  log.info("Contract event polling active (10s interval)");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_MAP = [
  "submitted", "verified", "approved", "rejected", "funded",
  "delivery_submitted", "delivery_verified", "delivery_failed",
  "settled", "timed_out",
];

const AID_TYPE_MAP = ["medical", "food", "shelter", "rescue", "comms", "evacuation"];

function formatRequest(raw) {
  return {
    id: Number(raw.id),
    requester: raw.requester,
    aidType: AID_TYPE_MAP[raw.aidType] || `type_${raw.aidType}`,
    urgency: ["medium", "high", "critical"][raw.urgency] || "unknown",
    lat: Number(raw.lat) / 1e7,
    lng: Number(raw.lng) / 1e7,
    detailsHash: raw.detailsHash,
    status: STATUS_MAP[raw.status] || `status_${raw.status}`,
    statusCode: Number(raw.status),
    createdAt: Number(raw.createdAt),
    galileoProofHash: raw.galileoProofHash,
    fdcEventId: raw.fdcEventId,
    verifiedAt: Number(raw.verifiedAt),
    consensusHash: raw.consensusHash,
    recommendedAid: AID_TYPE_MAP[raw.recommendedAid] || `type_${raw.recommendedAid}`,
    fulfillerType: raw.fulfillerType === 0 ? "drone" : "human",
    estimatedCostUSD: ethers.formatUnits(raw.estimatedCostUSD, 6),
    fulfiller: raw.fulfiller,
    escrowAmount: ethers.formatUnits(raw.escrowAmount, 6),
    fundedAt: Number(raw.fundedAt),
    deliveryProofHash: raw.deliveryProofHash,
    deliveryLat: Number(raw.deliveryLat) / 1e7,
    deliveryLng: Number(raw.deliveryLng) / 1e7,
    deliveredAt: Number(raw.deliveredAt),
    deliveryVerificationHash: raw.deliveryVerificationHash,
    settledAt: Number(raw.settledAt),
  };
}

export { provider, oracleSigner, aidChainContract, fundPoolContract, registryContract };
