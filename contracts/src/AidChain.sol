// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IAidChain.sol";
import "./FundPool.sol";
import "./VerificationRegistry.sol";

/**
 * @title AidChain
 * @notice Core contract for the decentralised humanitarian aid protocol.
 *
 * Lifecycle:
 *   1. User submits an aid request (requestAid)
 *   2. Oracle/backend posts Galileo OS-NMA + FDC verification (verifyRequest)
 *   3. LLM consensus panel result is submitted on-chain (submitConsensus)
 *   4. Contract is funded from the FundPool (FXRP → USDC swap happens off-chain
 *      before funding; the contract receives stablecoin)
 *   5. Fulfiller is assigned (assignFulfiller)
 *   6. Fulfiller marks delivery complete with proof hash (confirmDelivery)
 *   7. Dual verification: either GPS+camera proof (drone) or authority sig (human)
 *      is validated (verifyDelivery)
 *   8. Payout is released from escrow to fulfiller (releasePayout)
 */
contract AidChain is IAidChain {
    // ──────────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────────

    address public owner;
    address public oracleOperator;     // backend signer that relays oracle data
    FundPool public fundPool;
    VerificationRegistry public verificationRegistry;

    uint256 public nextRequestId;
    mapping(uint256 => AidRequest) public aidRequests;
    mapping(address => uint256[]) public userRequests;

    // Approved fulfillers (e.g. Zipline wallet, local authority wallets)
    mapping(address => bool) public approvedFulfillers;
    // Approved LLM panel operators that can submit consensus
    mapping(address => bool) public approvedPanelOperators;

    // ──────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "AidChain: not owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracleOperator, "AidChain: not oracle");
        _;
    }

    modifier onlyPanelOperator() {
        require(approvedPanelOperators[msg.sender], "AidChain: not panel operator");
        _;
    }

    modifier requestExists(uint256 requestId) {
        require(requestId < nextRequestId, "AidChain: request does not exist");
        _;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────────

    constructor(
        address _oracleOperator,
        address _fundPool,
        address _verificationRegistry
    ) {
        owner = msg.sender;
        oracleOperator = _oracleOperator;
        fundPool = FundPool(_fundPool);
        verificationRegistry = VerificationRegistry(_verificationRegistry);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Step 1 — Request Aid
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Submit a new aid request. Caller must have a verified identity
     *         in the VerificationRegistry (ZK-proof of government ID).
     * @param aidType       Encoded aid type (0=medical, 1=food, 2=shelter, ...)
     * @param urgency       0=medium, 1=high, 2=critical
     * @param lat           Latitude  × 1e7 (signed)
     * @param lng           Longitude × 1e7 (signed)
     * @param detailsHash   IPFS CID or keccak256 of free-text details
     */
    function requestAid(
        uint8 aidType,
        uint8 urgency,
        int64 lat,
        int64 lng,
        bytes32 detailsHash
    ) external override returns (uint256 requestId) {
        require(
            verificationRegistry.isIdentityVerified(msg.sender),
            "AidChain: identity not verified"
        );
        require(aidType <= 5, "AidChain: invalid aid type");
        require(urgency <= 2, "AidChain: invalid urgency");

        requestId = nextRequestId++;

        AidRequest storage r = aidRequests[requestId];
        r.id = requestId;
        r.requester = msg.sender;
        r.aidType = aidType;
        r.urgency = urgency;
        r.lat = lat;
        r.lng = lng;
        r.detailsHash = detailsHash;
        r.status = RequestStatus.Submitted;
        r.createdAt = block.timestamp;

        userRequests[msg.sender].push(requestId);

        emit AidRequested(requestId, msg.sender, aidType, urgency);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Step 2+3 — Galileo OS-NMA + FDC Event Verification (oracle relay)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Oracle operator submits verification proof for Galileo location
     *         authentication and FDC event confirmation.
     * @param requestId         The aid request to verify
     * @param galileoProofHash  Hash of the Galileo OS-NMA authentication bundle
     * @param fdcEventId        Identifier of the FDC-confirmed event
     * @param fdcProofHash      Hash of the FDC attestation data
     */
    function verifyRequest(
        uint256 requestId,
        bytes32 galileoProofHash,
        bytes32 fdcEventId,
        bytes32 fdcProofHash
    ) external override onlyOracle requestExists(requestId) {
        AidRequest storage r = aidRequests[requestId];
        require(r.status == RequestStatus.Submitted, "AidChain: wrong status");

        r.galileoProofHash = galileoProofHash;
        r.fdcEventId = fdcEventId;
        r.fdcProofHash = fdcProofHash;
        r.status = RequestStatus.Verified;
        r.verifiedAt = block.timestamp;

        emit RequestVerified(requestId, galileoProofHash, fdcEventId);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Step 4 — LLM Consensus
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Panel operator submits the LLM consensus decision.
     * @param requestId        The aid request
     * @param approved         Whether the panel approved the request
     * @param recommendedAid   The aid type the panel recommends (may differ from requested)
     * @param fulfillerType    0=drone, 1=human/authority
     * @param estimatedCostUSD Cost estimate in USD × 1e6 (USDC decimals)
     * @param consensusHash    Hash of the full consensus transcript for auditability
     * @param nodeCount        Number of LLM nodes that participated
     * @param approvalCount    Number of nodes that voted in favour
     */
    function submitConsensus(
        uint256 requestId,
        bool approved,
        uint8 recommendedAid,
        uint8 fulfillerType,
        uint256 estimatedCostUSD,
        bytes32 consensusHash,
        uint8 nodeCount,
        uint8 approvalCount
    ) external override onlyPanelOperator requestExists(requestId) {
        AidRequest storage r = aidRequests[requestId];
        require(r.status == RequestStatus.Verified, "AidChain: not verified");
        require(nodeCount >= 3, "AidChain: insufficient nodes");
        // Supermajority: > 2/3 must approve
        require(
            !approved || (approvalCount * 3 > nodeCount * 2),
            "AidChain: supermajority not met"
        );

        r.consensusHash = consensusHash;
        r.recommendedAid = recommendedAid;
        r.fulfillerType = fulfillerType;
        r.estimatedCostUSD = estimatedCostUSD;

        if (approved) {
            r.status = RequestStatus.Approved;
        } else {
            r.status = RequestStatus.Rejected;
        }

        emit ConsensusSubmitted(requestId, approved, recommendedAid, estimatedCostUSD);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Step 5 — Fund & Assign Fulfiller
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Fund the request from the FundPool escrow and assign a fulfiller.
     *         The FundPool must have already received USDC from the FXRP→USDC swap.
     * @param requestId  The approved request
     * @param fulfiller  Address of the assigned fulfiller
     */
    function assignFulfiller(
        uint256 requestId,
        address fulfiller
    ) external override onlyOracle requestExists(requestId) {
        AidRequest storage r = aidRequests[requestId];
        require(r.status == RequestStatus.Approved, "AidChain: not approved");
        require(approvedFulfillers[fulfiller], "AidChain: fulfiller not approved");

        // Pull funds into escrow inside this contract
        fundPool.escrowForRequest(requestId, r.estimatedCostUSD);

        r.fulfiller = fulfiller;
        r.escrowAmount = r.estimatedCostUSD;
        r.status = RequestStatus.Funded;
        r.fundedAt = block.timestamp;

        emit FulfillerAssigned(requestId, fulfiller, r.estimatedCostUSD);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Step 6 — Fulfiller Confirms Delivery
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Fulfiller submits delivery proof.
     * @param requestId       The request being fulfilled
     * @param deliveryHash    Hash of delivery proof (GPS coords + camera image for
     *                        drones, or authority digital signature for human aid)
     * @param deliveryLat     Delivery latitude × 1e7
     * @param deliveryLng     Delivery longitude × 1e7
     */
    function confirmDelivery(
        uint256 requestId,
        bytes32 deliveryHash,
        int64 deliveryLat,
        int64 deliveryLng
    ) external override requestExists(requestId) {
        AidRequest storage r = aidRequests[requestId];
        require(r.status == RequestStatus.Funded, "AidChain: not funded");
        require(msg.sender == r.fulfiller, "AidChain: not assigned fulfiller");

        r.deliveryProofHash = deliveryHash;
        r.deliveryLat = deliveryLat;
        r.deliveryLng = deliveryLng;
        r.status = RequestStatus.DeliverySubmitted;
        r.deliveredAt = block.timestamp;

        emit DeliveryConfirmed(requestId, deliveryHash);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Step 7 — Verify Delivery (dual verification)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Oracle operator verifies the delivery proof.
     *         For drones: GPS match + camera verification.
     *         For human aid: authority digital signature validation.
     * @param requestId          The request
     * @param verified           Whether delivery is confirmed valid
     * @param verificationHash   Hash of the verification attestation
     */
    function verifyDelivery(
        uint256 requestId,
        bool verified,
        bytes32 verificationHash
    ) external override onlyOracle requestExists(requestId) {
        AidRequest storage r = aidRequests[requestId];
        require(
            r.status == RequestStatus.DeliverySubmitted,
            "AidChain: delivery not submitted"
        );

        r.deliveryVerificationHash = verificationHash;

        if (verified) {
            r.status = RequestStatus.DeliveryVerified;
        } else {
            // Delivery failed verification — can be retried or disputed
            r.status = RequestStatus.DeliveryFailed;
        }

        emit DeliveryVerified(requestId, verified, verificationHash);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Step 8 — Release Payout
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Release escrowed funds to the fulfiller after verified delivery.
     * @param requestId The request to settle
     */
    function releasePayout(
        uint256 requestId
    ) external override onlyOracle requestExists(requestId) {
        AidRequest storage r = aidRequests[requestId];
        require(
            r.status == RequestStatus.DeliveryVerified,
            "AidChain: delivery not verified"
        );

        r.status = RequestStatus.Settled;
        r.settledAt = block.timestamp;

        // Release from FundPool to fulfiller
        fundPool.releaseTo(r.fulfiller, r.escrowAmount);

        emit PayoutReleased(requestId, r.fulfiller, r.escrowAmount);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Dispute / Timeout Handling
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice If delivery is not confirmed within the timeout window,
     *         escrowed funds can be returned to the pool.
     * @param requestId The request to timeout
     */
    function timeoutRequest(
        uint256 requestId
    ) external onlyOracle requestExists(requestId) {
        AidRequest storage r = aidRequests[requestId];
        require(
            r.status == RequestStatus.Funded ||
            r.status == RequestStatus.DeliveryFailed,
            "AidChain: cannot timeout"
        );
        // 24-hour timeout for funded requests
        require(
            block.timestamp > r.fundedAt + 24 hours,
            "AidChain: timeout not reached"
        );

        r.status = RequestStatus.TimedOut;
        fundPool.returnToPool(r.escrowAmount);

        emit RequestTimedOut(requestId);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────────────────

    function setOracleOperator(address _oracle) external onlyOwner {
        oracleOperator = _oracle;
    }

    function setFulfiller(address fulfiller, bool approved) external onlyOwner {
        approvedFulfillers[fulfiller] = approved;
        emit FulfillerStatusChanged(fulfiller, approved);
    }

    function setPanelOperator(address operator, bool approved) external onlyOwner {
        approvedPanelOperators[operator] = approved;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Views
    // ──────────────────────────────────────────────────────────────────────────

    function getRequest(uint256 requestId)
        external
        view
        override
        requestExists(requestId)
        returns (AidRequest memory)
    {
        return aidRequests[requestId];
    }

    function getUserRequests(address user)
        external
        view
        override
        returns (uint256[] memory)
    {
        return userRequests[user];
    }

    function getRequestCount() external view returns (uint256) {
        return nextRequestId;
    }
}
