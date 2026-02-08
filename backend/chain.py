"""
chain.py — Shared chain connection module for Coston2 (Flare testnet).

The backend (organization's oracle) holds the private key and is the sole
entity that signs and sends transactions on behalf of disaster victims.
"""

import os
import time
import logging
from functools import lru_cache

from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware
from eth_account import Account

logger = logging.getLogger("aegis.chain")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
COSTON2_RPC = "https://coston2-api.flare.network/ext/C/rpc"
CHAIN_ID = 114

# Minimal ABIs — only the functions we actually call
MISSION_CONTROL_ABI = [
    {
        "inputs": [{"name": "_gps", "type": "string"}, {"name": "_aidType", "type": "string"}],
        "name": "createRequest",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "_requestId", "type": "uint256"},
            {"name": "_merkleProof", "type": "bytes32[]"},
            {"name": "_merkleRoot", "type": "bytes32"},
            {"name": "_leaf", "type": "bytes32"},
        ],
        "name": "verifyEvent",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "_requestId", "type": "uint256"},
            {"name": "_provider", "type": "address"},
            {"name": "_costUSD", "type": "uint256"},
        ],
        "name": "approveAid",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "_requestId", "type": "uint256"},
            {"name": "_merkleProof", "type": "bytes32[]"},
            {"name": "_merkleRoot", "type": "bytes32"},
            {"name": "_leaf", "type": "bytes32"},
        ],
        "name": "confirmDelivery",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "requestCounter",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"name": "", "type": "uint256"}],
        "name": "requests",
        "outputs": [
            {"name": "id", "type": "uint256"},
            {"name": "requester", "type": "address"},
            {"name": "status", "type": "uint8"},
            {"name": "assignedProvider", "type": "address"},
            {"name": "approvedCostUSD", "type": "uint256"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
    # Events
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "id", "type": "uint256"},
            {"indexed": True, "name": "requester", "type": "address"},
        ],
        "name": "RequestCreated",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [{"indexed": True, "name": "id", "type": "uint256"}],
        "name": "EventVerified",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [{"indexed": True, "name": "id", "type": "uint256"}],
        "name": "AidApproved",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [{"indexed": True, "name": "id", "type": "uint256"}],
        "name": "MissionComplete",
        "type": "event",
    },
]

AID_TREASURY_ABI = [
    {
        "inputs": [
            {"name": "_provider", "type": "address"},
            {"name": "_usdAmount", "type": "uint256"},
        ],
        "name": "processPayout",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

# Solidity enum mapping: Status { PENDING, EVENT_VERIFIED, APPROVED, FULFILLED }
STATUS_MAP = {0: "PENDING", 1: "EVENT_VERIFIED", 2: "APPROVED", 3: "FULFILLED"}


# ---------------------------------------------------------------------------
# Singleton web3 + account setup
# ---------------------------------------------------------------------------
def _get_w3() -> Web3:
    w3 = Web3(Web3.HTTPProvider(COSTON2_RPC, request_kwargs={"timeout": 30}))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    return w3


@lru_cache(maxsize=1)
def get_chain():
    """Returns (w3, account, mission_control, aid_treasury) or raises."""
    private_key = os.getenv("ORACLE_PRIVATE_KEY")
    mc_address = os.getenv("MISSION_CONTROL_ADDRESS")
    treasury_address = os.getenv("AID_TREASURY_ADDRESS")

    if not private_key or not mc_address:
        raise RuntimeError(
            "Chain not configured. Set ORACLE_PRIVATE_KEY and MISSION_CONTROL_ADDRESS in backend/.env"
        )

    w3 = _get_w3()
    account = Account.from_key(private_key)

    mission_control = w3.eth.contract(
        address=Web3.to_checksum_address(mc_address),
        abi=MISSION_CONTROL_ABI,
    )

    aid_treasury = None
    if treasury_address:
        aid_treasury = w3.eth.contract(
            address=Web3.to_checksum_address(treasury_address),
            abi=AID_TREASURY_ABI,
        )

    logger.info(f"Chain connected — oracle={account.address}, mc={mc_address}")
    return w3, account, mission_control, aid_treasury


def is_chain_configured() -> bool:
    """Check if on-chain integration is available (env vars set)."""
    return bool(os.getenv("ORACLE_PRIVATE_KEY") and os.getenv("MISSION_CONTROL_ADDRESS"))


# ---------------------------------------------------------------------------
# Transaction helper with retry
# ---------------------------------------------------------------------------
def send_tx(contract_fn, *args, max_retries: int = 3):
    """
    Build, sign, send, and wait for a contract function call.
    Returns the tx receipt on success, raises on failure.
    """
    w3, account, _, _ = get_chain()

    for attempt in range(1, max_retries + 1):
        try:
            nonce = w3.eth.get_transaction_count(account.address, "pending")
            gas_price = w3.eth.gas_price

            tx = contract_fn(*args).build_transaction({
                "from": account.address,
                "nonce": nonce,
                "gas": 500_000,
                "gasPrice": int(gas_price * 1.2),  # slight overpay for reliability
                "chainId": CHAIN_ID,
            })

            signed = account.sign_transaction(tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)

            if receipt.status != 1:
                raise RuntimeError(f"Tx reverted: {tx_hash.hex()}")

            logger.info(f"Tx confirmed: {tx_hash.hex()} (gas={receipt.gasUsed})")
            return receipt

        except Exception as e:
            logger.warning(f"send_tx attempt {attempt}/{max_retries} failed: {e}")
            if attempt == max_retries:
                raise
            time.sleep(2 ** attempt)  # exponential backoff


def get_request_status(request_id: int) -> dict:
    """Read a request's on-chain status from MissionControl.requests(id)."""
    _, _, mission_control, _ = get_chain()
    result = mission_control.functions.requests(request_id).call()
    # result = (id, requester, status, assignedProvider, approvedCostUSD)
    return {
        "request_id": result[0],
        "requester": result[1],
        "status": STATUS_MAP.get(result[2], "UNKNOWN"),
        "provider": result[3],
        "cost_usd": result[4],
    }


# ---------------------------------------------------------------------------
# Shared in-memory on-chain event log (for the activity feed)
# ---------------------------------------------------------------------------
ON_CHAIN_EVENTS: list = []


def log_chain_event(event_type: str, request_id: int, tx_hash: str):
    """Log an on-chain event for the activity feed."""
    from datetime import datetime

    ON_CHAIN_EVENTS.append({
        "type": event_type,
        "request_id": request_id,
        "tx_hash": tx_hash,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    })
    # Keep last 50
    if len(ON_CHAIN_EVENTS) > 50:
        ON_CHAIN_EVENTS.pop(0)
