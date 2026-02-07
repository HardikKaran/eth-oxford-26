// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title VerificationRegistry
 * @notice Manages user identity verification using zero-knowledge proofs.
 *
 * Users register their wallet address with a ZK-proof that attests to a valid
 * government ID without revealing the underlying personal data. The proof is
 * verified on-chain (or via a verifier contract) and the result is stored.
 *
 * This prevents:
 *   - Sybil attacks (one ID = one verified address)
 *   - Identity exposure (ZK-proof reveals nothing about the person)
 *   - Duplicate claims (nullifier hash ensures uniqueness)
 */
contract VerificationRegistry {
    // ──────────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────────

    address public owner;
    address public zkVerifier;          // address of ZK proof verifier contract

    struct Identity {
        bool verified;
        bytes32 nullifierHash;          // unique per government ID, prevents duplicates
        bytes32 proofHash;              // hash of the ZK proof for auditability
        uint256 verifiedAt;
        uint256 expiresAt;              // verification validity period
        bool revoked;
    }

    mapping(address => Identity) public identities;
    mapping(bytes32 => bool) public usedNullifiers;     // prevent same ID on multiple addresses

    uint256 public totalVerified;
    uint256 public verificationValidityPeriod = 365 days;

    // ──────────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────────

    event IdentityVerified(
        address indexed user,
        bytes32 nullifierHash,
        uint256 expiresAt
    );

    event IdentityRevoked(address indexed user, string reason);

    event VerifierUpdated(address indexed newVerifier);

    // ──────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Registry: not owner");
        _;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────────

    constructor(address _zkVerifier) {
        owner = msg.sender;
        zkVerifier = _zkVerifier;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Registration
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Register a verified identity using a ZK proof.
     * @param nullifierHash   Unique hash derived from government ID (prevents reuse)
     * @param proofHash       Hash of the ZK proof data
     * @param zkProof         The actual ZK proof bytes (verified by the verifier contract)
     */
    function registerIdentity(
        bytes32 nullifierHash,
        bytes32 proofHash,
        bytes calldata zkProof
    ) external {
        require(!identities[msg.sender].verified, "Registry: already verified");
        require(!usedNullifiers[nullifierHash], "Registry: ID already registered");
        require(nullifierHash != bytes32(0), "Registry: zero nullifier");

        // Verify the ZK proof via the verifier contract
        // In production, this calls a Groth16/PLONK verifier
        bool valid = _verifyProof(msg.sender, nullifierHash, zkProof);
        require(valid, "Registry: invalid ZK proof");

        uint256 expiresAt = block.timestamp + verificationValidityPeriod;

        identities[msg.sender] = Identity({
            verified: true,
            nullifierHash: nullifierHash,
            proofHash: proofHash,
            verifiedAt: block.timestamp,
            expiresAt: expiresAt,
            revoked: false
        });

        usedNullifiers[nullifierHash] = true;
        totalVerified++;

        emit IdentityVerified(msg.sender, nullifierHash, expiresAt);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Verification Check
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Check if an address has a valid, non-expired, non-revoked identity.
     */
    function isIdentityVerified(address user) external view returns (bool) {
        Identity storage id = identities[user];
        return id.verified && !id.revoked && block.timestamp < id.expiresAt;
    }

    /**
     * @notice Get full identity details for an address.
     */
    function getIdentity(address user) external view returns (Identity memory) {
        return identities[user];
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Revocation
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Revoke a verified identity (fraud detection, etc.).
     */
    function revokeIdentity(address user, string calldata reason) external onlyOwner {
        require(identities[user].verified, "Registry: not verified");
        identities[user].revoked = true;
        emit IdentityRevoked(user, reason);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Internal — ZK Proof Verification
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @dev Verify a ZK proof. In production, this calls an external verifier
     *      contract (e.g. Groth16Verifier deployed from circom/snarkjs).
     *      For the initial version, we use a simplified interface.
     */
    function _verifyProof(
        address user,
        bytes32 nullifierHash,
        bytes calldata zkProof
    ) internal view returns (bool) {
        // Production: call the ZK verifier contract
        //   IZKVerifier(zkVerifier).verify(proof, publicSignals)
        //
        // For development/testing, we accept any non-empty proof.
        // This MUST be replaced with real verification before mainnet.
        if (zkVerifier == address(0)) {
            return zkProof.length > 0;
        }

        // Call external verifier
        (bool success, bytes memory result) = zkVerifier.staticcall(
            abi.encodeWithSignature(
                "verifyProof(address,bytes32,bytes)",
                user,
                nullifierHash,
                zkProof
            )
        );

        if (!success || result.length == 0) return false;
        return abi.decode(result, (bool));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────────────────────────────────

    function setVerifier(address _verifier) external onlyOwner {
        zkVerifier = _verifier;
        emit VerifierUpdated(_verifier);
    }

    function setValidityPeriod(uint256 period) external onlyOwner {
        verificationValidityPeriod = period;
    }
}
