// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAidChain
 * @notice Interface and type definitions for the AidChain protocol.
 */
interface IAidChain {
    // ──────────────────────────────────────────────────────────────────────────
    // Enums
    // ──────────────────────────────────────────────────────────────────────────

    enum RequestStatus {
        Submitted,          // 0 — User submitted request
        Verified,           // 1 — Galileo + FDC verified
        Approved,           // 2 — LLM panel approved
        Rejected,           // 3 — LLM panel rejected
        Funded,             // 4 — Escrow funded, fulfiller assigned
        DeliverySubmitted,  // 5 — Fulfiller submitted delivery proof
        DeliveryVerified,   // 6 — Oracle verified delivery
        DeliveryFailed,     // 7 — Delivery verification failed
        Settled,            // 8 — Payout released
        TimedOut            // 9 — Request timed out
    }

    // Aid types:
    //   0 = Medical Supplies
    //   1 = Food & Water
    //   2 = Shelter Materials
    //   3 = Search & Rescue
    //   4 = Communications
    //   5 = Evacuation

    // Fulfiller types:
    //   0 = Drone (e.g. Zipline)
    //   1 = Human / Authority

    // ──────────────────────────────────────────────────────────────────────────
    // Structs
    // ──────────────────────────────────────────────────────────────────────────

    struct AidRequest {
        uint256 id;
        address requester;
        uint8 aidType;
        uint8 urgency;              // 0=medium, 1=high, 2=critical
        int64 lat;                  // × 1e7
        int64 lng;                  // × 1e7
        bytes32 detailsHash;        // IPFS CID or keccak256

        RequestStatus status;
        uint256 createdAt;

        // Verification (stages 2+3)
        bytes32 galileoProofHash;
        bytes32 fdcEventId;
        bytes32 fdcProofHash;
        uint256 verifiedAt;

        // Consensus (stage 4)
        bytes32 consensusHash;
        uint8 recommendedAid;
        uint8 fulfillerType;        // 0=drone, 1=human
        uint256 estimatedCostUSD;   // in USDC decimals (6)

        // Funding & fulfillment (stages 5+6)
        address fulfiller;
        uint256 escrowAmount;
        uint256 fundedAt;

        // Delivery (stage 6+7)
        bytes32 deliveryProofHash;
        int64 deliveryLat;
        int64 deliveryLng;
        uint256 deliveredAt;
        bytes32 deliveryVerificationHash;

        // Settlement (stage 8)
        uint256 settledAt;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────────

    event AidRequested(
        uint256 indexed requestId,
        address indexed requester,
        uint8 aidType,
        uint8 urgency
    );

    event RequestVerified(
        uint256 indexed requestId,
        bytes32 galileoProofHash,
        bytes32 fdcEventId
    );

    event ConsensusSubmitted(
        uint256 indexed requestId,
        bool approved,
        uint8 recommendedAid,
        uint256 estimatedCostUSD
    );

    event FulfillerAssigned(
        uint256 indexed requestId,
        address indexed fulfiller,
        uint256 escrowAmount
    );

    event DeliveryConfirmed(
        uint256 indexed requestId,
        bytes32 deliveryHash
    );

    event DeliveryVerified(
        uint256 indexed requestId,
        bool verified,
        bytes32 verificationHash
    );

    event PayoutReleased(
        uint256 indexed requestId,
        address indexed fulfiller,
        uint256 amount
    );

    event RequestTimedOut(uint256 indexed requestId);

    event FulfillerStatusChanged(address indexed fulfiller, bool approved);

    // ──────────────────────────────────────────────────────────────────────────
    // Functions
    // ──────────────────────────────────────────────────────────────────────────

    function requestAid(
        uint8 aidType,
        uint8 urgency,
        int64 lat,
        int64 lng,
        bytes32 detailsHash
    ) external returns (uint256 requestId);

    function verifyRequest(
        uint256 requestId,
        bytes32 galileoProofHash,
        bytes32 fdcEventId,
        bytes32 fdcProofHash
    ) external;

    function submitConsensus(
        uint256 requestId,
        bool approved,
        uint8 recommendedAid,
        uint8 fulfillerType,
        uint256 estimatedCostUSD,
        bytes32 consensusHash,
        uint8 nodeCount,
        uint8 approvalCount
    ) external;

    function assignFulfiller(
        uint256 requestId,
        address fulfiller
    ) external;

    function confirmDelivery(
        uint256 requestId,
        bytes32 deliveryHash,
        int64 deliveryLat,
        int64 deliveryLng
    ) external;

    function verifyDelivery(
        uint256 requestId,
        bool verified,
        bytes32 verificationHash
    ) external;

    function releasePayout(
        uint256 requestId
    ) external;

    function getRequest(uint256 requestId) external view returns (AidRequest memory);
    function getUserRequests(address user) external view returns (uint256[] memory);
}
