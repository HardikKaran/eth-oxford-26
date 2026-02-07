const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AidChain Protocol", function () {
  let owner, oracle, user, fulfiller, panelOp;
  let usdc, registry, fundPool, aidChain;

  const AID_MEDICAL = 0;
  const URGENCY_HIGH = 1;
  const LAT = 170523000;   // -17.0523 × 1e7
  const LNG = 368714000;   //  36.8714 × 1e7
  const COST = 150_000000; // 150 USDC (6 decimals)

  beforeEach(async function () {
    [owner, oracle, user, fulfiller, panelOp] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    // Deploy VerificationRegistry (dev mode: no real ZK verifier)
    const Registry = await ethers.getContractFactory("VerificationRegistry");
    registry = await Registry.deploy(ethers.ZeroAddress);

    // Deploy FundPool
    const FundPool = await ethers.getContractFactory("FundPool");
    fundPool = await FundPool.deploy(await usdc.getAddress());

    // Deploy AidChain
    const AidChain = await ethers.getContractFactory("AidChain");
    aidChain = await AidChain.deploy(
      oracle.address,
      await fundPool.getAddress(),
      await registry.getAddress()
    );

    // Wire up
    await fundPool.setAidChainContract(await aidChain.getAddress());
    await aidChain.setFulfiller(fulfiller.address, true);
    await aidChain.setPanelOperator(panelOp.address, true);

    // Verify user identity
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes("user-gov-id-123"));
    const proofHash = ethers.keccak256(ethers.toUtf8Bytes("proof"));
    const zkProof = ethers.toUtf8Bytes("mock-zk-proof");
    await registry.connect(user).registerIdentity(nullifier, proofHash, zkProof);

    // Fund the pool: transfer USDC to owner, approve, deposit
    await usdc.approve(await fundPool.getAddress(), 1_000_000_000000n);
    const swapTxHash = ethers.keccak256(ethers.toUtf8Bytes("fxrp-swap-1"));
    await fundPool.deposit(1_000_000_000000n, swapTxHash);
  });

  describe("Step 1: Request Aid", function () {
    it("should allow verified user to submit a request", async function () {
      const detailsHash = ethers.keccak256(ethers.toUtf8Bytes("need medical supplies"));
      const tx = await aidChain.connect(user).requestAid(
        AID_MEDICAL, URGENCY_HIGH, LAT, LNG, detailsHash
      );
      await tx.wait();

      const req = await aidChain.getRequest(0);
      expect(req.requester).to.equal(user.address);
      expect(req.aidType).to.equal(AID_MEDICAL);
      expect(req.status).to.equal(0); // Submitted
    });

    it("should reject unverified user", async function () {
      const [, , , , , unverified] = await ethers.getSigners();
      const detailsHash = ethers.keccak256(ethers.toUtf8Bytes("details"));
      await expect(
        aidChain.connect(unverified).requestAid(AID_MEDICAL, URGENCY_HIGH, LAT, LNG, detailsHash)
      ).to.be.revertedWith("AidChain: identity not verified");
    });
  });

  describe("Step 2+3: Galileo + FDC Verification", function () {
    beforeEach(async function () {
      const detailsHash = ethers.keccak256(ethers.toUtf8Bytes("details"));
      await aidChain.connect(user).requestAid(AID_MEDICAL, URGENCY_HIGH, LAT, LNG, detailsHash);
    });

    it("should allow oracle to verify request", async function () {
      const galileoProof = ethers.keccak256(ethers.toUtf8Bytes("galileo-osnma-proof"));
      const fdcEventId = ethers.keccak256(ethers.toUtf8Bytes("flood_moz_2026"));
      const fdcProof = ethers.keccak256(ethers.toUtf8Bytes("fdc-attestation"));

      await aidChain.connect(oracle).verifyRequest(0, galileoProof, fdcEventId, fdcProof);
      const req = await aidChain.getRequest(0);
      expect(req.status).to.equal(1); // Verified
    });

    it("should reject non-oracle verification", async function () {
      const h = ethers.keccak256(ethers.toUtf8Bytes("x"));
      await expect(
        aidChain.connect(user).verifyRequest(0, h, h, h)
      ).to.be.revertedWith("AidChain: not oracle");
    });
  });

  describe("Step 4: LLM Consensus", function () {
    beforeEach(async function () {
      const detailsHash = ethers.keccak256(ethers.toUtf8Bytes("details"));
      await aidChain.connect(user).requestAid(AID_MEDICAL, URGENCY_HIGH, LAT, LNG, detailsHash);
      const h = ethers.keccak256(ethers.toUtf8Bytes("proof"));
      await aidChain.connect(oracle).verifyRequest(0, h, h, h);
    });

    it("should accept consensus with supermajority", async function () {
      const consensusHash = ethers.keccak256(ethers.toUtf8Bytes("consensus-transcript"));
      await aidChain.connect(panelOp).submitConsensus(
        0, true, AID_MEDICAL, 0, COST, consensusHash, 5, 4 // 4/5 > 2/3
      );
      const req = await aidChain.getRequest(0);
      expect(req.status).to.equal(2); // Approved
    });

    it("should reject consensus without supermajority", async function () {
      const consensusHash = ethers.keccak256(ethers.toUtf8Bytes("consensus"));
      await expect(
        aidChain.connect(panelOp).submitConsensus(
          0, true, AID_MEDICAL, 0, COST, consensusHash, 5, 2 // 2/5 < 2/3
        )
      ).to.be.revertedWith("AidChain: supermajority not met");
    });

    it("should allow rejection without supermajority check", async function () {
      const consensusHash = ethers.keccak256(ethers.toUtf8Bytes("consensus"));
      await aidChain.connect(panelOp).submitConsensus(
        0, false, AID_MEDICAL, 0, COST, consensusHash, 5, 1
      );
      const req = await aidChain.getRequest(0);
      expect(req.status).to.equal(3); // Rejected
    });
  });

  describe("Step 5: Fund & Assign Fulfiller", function () {
    beforeEach(async function () {
      const detailsHash = ethers.keccak256(ethers.toUtf8Bytes("details"));
      await aidChain.connect(user).requestAid(AID_MEDICAL, URGENCY_HIGH, LAT, LNG, detailsHash);
      const h = ethers.keccak256(ethers.toUtf8Bytes("proof"));
      await aidChain.connect(oracle).verifyRequest(0, h, h, h);
      const ch = ethers.keccak256(ethers.toUtf8Bytes("consensus"));
      await aidChain.connect(panelOp).submitConsensus(0, true, AID_MEDICAL, 0, COST, ch, 5, 4);
    });

    it("should fund and assign fulfiller", async function () {
      await aidChain.connect(oracle).assignFulfiller(0, fulfiller.address);
      const req = await aidChain.getRequest(0);
      expect(req.status).to.equal(4); // Funded
      expect(req.fulfiller).to.equal(fulfiller.address);
    });

    it("should reject unapproved fulfiller", async function () {
      const [, , , , , rando] = await ethers.getSigners();
      await expect(
        aidChain.connect(oracle).assignFulfiller(0, rando.address)
      ).to.be.revertedWith("AidChain: fulfiller not approved");
    });
  });

  describe("Steps 6-8: Delivery → Settlement", function () {
    beforeEach(async function () {
      // Run through steps 1-5
      const detailsHash = ethers.keccak256(ethers.toUtf8Bytes("details"));
      await aidChain.connect(user).requestAid(AID_MEDICAL, URGENCY_HIGH, LAT, LNG, detailsHash);
      const h = ethers.keccak256(ethers.toUtf8Bytes("proof"));
      await aidChain.connect(oracle).verifyRequest(0, h, h, h);
      const ch = ethers.keccak256(ethers.toUtf8Bytes("consensus"));
      await aidChain.connect(panelOp).submitConsensus(0, true, AID_MEDICAL, 0, COST, ch, 5, 4);
      await aidChain.connect(oracle).assignFulfiller(0, fulfiller.address);
    });

    it("should complete full delivery and settlement lifecycle", async function () {
      // Step 6: Fulfiller confirms delivery
      const deliveryHash = ethers.keccak256(ethers.toUtf8Bytes("gps+camera-proof"));
      await aidChain.connect(fulfiller).confirmDelivery(0, deliveryHash, LAT, LNG);
      let req = await aidChain.getRequest(0);
      expect(req.status).to.equal(5); // DeliverySubmitted

      // Step 7: Oracle verifies delivery
      const verificationHash = ethers.keccak256(ethers.toUtf8Bytes("verification-attestation"));
      await aidChain.connect(oracle).verifyDelivery(0, true, verificationHash);
      req = await aidChain.getRequest(0);
      expect(req.status).to.equal(6); // DeliveryVerified

      // Step 8: Release payout
      const balBefore = await usdc.balanceOf(fulfiller.address);
      await aidChain.connect(oracle).releasePayout(0);
      const balAfter = await usdc.balanceOf(fulfiller.address);

      req = await aidChain.getRequest(0);
      expect(req.status).to.equal(8); // Settled
      expect(balAfter - balBefore).to.equal(COST);
    });

    it("should handle failed delivery verification", async function () {
      const deliveryHash = ethers.keccak256(ethers.toUtf8Bytes("bad-proof"));
      await aidChain.connect(fulfiller).confirmDelivery(0, deliveryHash, LAT, LNG);

      const verificationHash = ethers.keccak256(ethers.toUtf8Bytes("failed-check"));
      await aidChain.connect(oracle).verifyDelivery(0, false, verificationHash);
      const req = await aidChain.getRequest(0);
      expect(req.status).to.equal(7); // DeliveryFailed
    });
  });

  describe("VerificationRegistry", function () {
    it("should prevent duplicate nullifier registration", async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("user-gov-id-123"));
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes("proof2"));
      const zkProof = ethers.toUtf8Bytes("mock-proof");

      // user is already registered in beforeEach
      const [, , , , , newUser] = await ethers.getSigners();
      await expect(
        registry.connect(newUser).registerIdentity(nullifier, proofHash, zkProof)
      ).to.be.revertedWith("Registry: ID already registered");
    });

    it("should allow revocation", async function () {
      await registry.revokeIdentity(user.address, "fraud detected");
      expect(await registry.isIdentityVerified(user.address)).to.be.false;
    });
  });

  describe("FundPool", function () {
    it("should track pool stats correctly", async function () {
      const [deposited, escrowed, paidOut, available] = await fundPool.getPoolStats();
      expect(deposited).to.equal(1_000_000_000000n);
      expect(available).to.equal(1_000_000_000000n);
    });

    it("should reject insufficient escrow", async function () {
      // Request more than available
      const detailsHash = ethers.keccak256(ethers.toUtf8Bytes("details"));
      await aidChain.connect(user).requestAid(AID_MEDICAL, URGENCY_HIGH, LAT, LNG, detailsHash);
      const h = ethers.keccak256(ethers.toUtf8Bytes("proof"));
      await aidChain.connect(oracle).verifyRequest(0, h, h, h);

      const hugeCost = 2_000_000_000000n; // 2M USDC, more than deposited
      const ch = ethers.keccak256(ethers.toUtf8Bytes("consensus"));
      await aidChain.connect(panelOp).submitConsensus(0, true, AID_MEDICAL, 0, hugeCost, ch, 5, 4);

      await expect(
        aidChain.connect(oracle).assignFulfiller(0, fulfiller.address)
      ).to.be.revertedWith("FundPool: insufficient funds");
    });
  });
});
