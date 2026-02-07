// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IERC20.sol";

/**
 * @title FundPool
 * @notice Manages the aid fund pool. Holds USDC/USDT received from FXRP swaps,
 *         handles escrow for active requests, and releases payouts to fulfillers.
 *
 * Flow:
 *   1. Treasury deposits USDC/USDT after off-chain FXRP → stablecoin swap
 *   2. AidChain contract calls escrowForRequest() to lock funds
 *   3. On verified delivery, AidChain calls releaseTo() to pay fulfiller
 *   4. On timeout/failure, AidChain calls returnToPool() to unlock funds
 */
contract FundPool {
    // ──────────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────────

    address public owner;
    address public aidChainContract;    // only AidChain can escrow/release
    IERC20 public stablecoin;           // USDC or USDT

    uint256 public totalDeposited;
    uint256 public totalEscrowed;
    uint256 public totalPaidOut;
    uint256 public availableBalance;

    // Per-request escrow tracking
    mapping(uint256 => uint256) public requestEscrow;

    // Deposit tracking for transparency
    struct Deposit {
        address depositor;
        uint256 amount;
        uint256 timestamp;
        bytes32 swapTxHash;     // reference to the FXRP→USDC swap tx
    }
    Deposit[] public deposits;

    // ──────────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────────

    event FundsDeposited(
        address indexed depositor,
        uint256 amount,
        bytes32 swapTxHash
    );

    event FundsEscrowed(
        uint256 indexed requestId,
        uint256 amount
    );

    event FundsReleased(
        address indexed recipient,
        uint256 amount
    );

    event FundsReturned(uint256 amount);

    event EmergencyWithdrawal(address indexed to, uint256 amount);

    // ──────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "FundPool: not owner");
        _;
    }

    modifier onlyAidChain() {
        require(msg.sender == aidChainContract, "FundPool: not AidChain");
        _;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────────

    constructor(address _stablecoin) {
        owner = msg.sender;
        stablecoin = IERC20(_stablecoin);
    }

    function setAidChainContract(address _aidChain) external onlyOwner {
        aidChainContract = _aidChain;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Deposit (treasury / swap settlement)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposit stablecoin into the fund pool after FXRP swap.
     * @param amount       Amount of USDC/USDT to deposit
     * @param swapTxHash   Reference hash of the FXRP→stablecoin swap transaction
     */
    function deposit(uint256 amount, bytes32 swapTxHash) external {
        require(amount > 0, "FundPool: zero amount");

        stablecoin.transferFrom(msg.sender, address(this), amount);

        totalDeposited += amount;
        availableBalance += amount;

        deposits.push(Deposit({
            depositor: msg.sender,
            amount: amount,
            timestamp: block.timestamp,
            swapTxHash: swapTxHash
        }));

        emit FundsDeposited(msg.sender, amount, swapTxHash);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Escrow (called by AidChain)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Lock funds in escrow for a specific aid request.
     * @param requestId  The aid request ID
     * @param amount     Amount to escrow in USDC decimals
     */
    function escrowForRequest(
        uint256 requestId,
        uint256 amount
    ) external onlyAidChain {
        require(availableBalance >= amount, "FundPool: insufficient funds");
        require(requestEscrow[requestId] == 0, "FundPool: already escrowed");

        availableBalance -= amount;
        totalEscrowed += amount;
        requestEscrow[requestId] = amount;

        emit FundsEscrowed(requestId, amount);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Release (called by AidChain on verified delivery)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Release escrowed funds to a fulfiller.
     * @param recipient  The fulfiller's address
     * @param amount     Amount to release
     */
    function releaseTo(
        address recipient,
        uint256 amount
    ) external onlyAidChain {
        require(totalEscrowed >= amount, "FundPool: escrow underflow");

        totalEscrowed -= amount;
        totalPaidOut += amount;

        stablecoin.transfer(recipient, amount);

        emit FundsReleased(recipient, amount);
    }

    /**
     * @notice Return escrowed funds to the available pool (timeout/failure).
     * @param amount Amount to return
     */
    function returnToPool(uint256 amount) external onlyAidChain {
        require(totalEscrowed >= amount, "FundPool: escrow underflow");

        totalEscrowed -= amount;
        availableBalance += amount;

        emit FundsReturned(amount);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Views
    // ──────────────────────────────────────────────────────────────────────────

    function getPoolStats() external view returns (
        uint256 _totalDeposited,
        uint256 _totalEscrowed,
        uint256 _totalPaidOut,
        uint256 _availableBalance
    ) {
        return (totalDeposited, totalEscrowed, totalPaidOut, availableBalance);
    }

    function getDepositCount() external view returns (uint256) {
        return deposits.length;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Emergency
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Emergency withdrawal — multisig governance should replace this
     *         with a DAO vote in production.
     */
    function emergencyWithdraw(address to) external onlyOwner {
        uint256 bal = stablecoin.balanceOf(address(this));
        stablecoin.transfer(to, bal);
        availableBalance = 0;
        totalEscrowed = 0;
        emit EmergencyWithdrawal(to, bal);
    }
}
