"""
fdc_client.py — FDC (Flare Data Connector) verification for disaster events.

Currently uses a mock Merkle proof for the demo. See TODO comments for
the real FDC attestation flow.
"""

import logging
from web3 import Web3

from chain import get_chain, send_tx, is_chain_configured, log_chain_event

logger = logging.getLogger("aegis.fdc")


def _mock_merkle_proof(request_id: int, purpose: str, lat: float = 0, lng: float = 0) -> tuple:
    """
    Generate a deterministic mock Merkle proof.
    In real FDC, this would come from the FdcVerification relay contract.
    
    Returns: (proof: list[bytes32], root: bytes32, leaf: bytes32)
    """
    # TODO: Replace mock with real FDC attestation
    # 1. Encode a Web2Json attestation request:
    #    "Verify that https://earthquake.usgs.gov/... returns magnitude >= 2.5 within 100km of (lat, lng)"
    # 2. Submit attestation request to FdcHub contract on Coston2
    # 3. Wait for the attestation round to finalize (~90 seconds)
    # 4. Retrieve the Merkle proof from the FdcVerification relay contract
    # 5. Pass the real proof/root/leaf to verifyEvent()

    leaf = Web3.solidity_keccak(
        ["uint256", "string", "string"],
        [request_id, purpose, f"{lat},{lng}"]
    )
    # Single-element proof where root == leaf (mock accepts this)
    root = leaf
    proof = []  # empty proof — root == leaf, MockFdcVerification returns true
    return proof, root, leaf


async def verify_event(request_id: int, lat: float, lng: float) -> str | None:
    """
    Verify a disaster event via FDC proof and call MissionControl.verifyEvent().
    
    Returns the tx hash on success, None on failure.
    """
    if not is_chain_configured():
        logger.warning("Chain not configured — skipping verifyEvent")
        return None

    try:
        _, _, mission_control, _ = get_chain()
        proof, root, leaf = _mock_merkle_proof(request_id, "disaster_verified", lat, lng)

        receipt = await send_tx(
            mission_control.functions.verifyEvent,
            request_id, proof, root, leaf
        )
        tx_hash = receipt.transactionHash.hex()
        logger.info(f"verifyEvent #{request_id} confirmed — tx {tx_hash}")
        log_chain_event("EventVerified", request_id, tx_hash)
        return tx_hash

    except Exception as e:
        logger.error(f"verifyEvent #{request_id} failed: {e}")
        return None


async def confirm_delivery(request_id: int) -> str | None:
    """
    Confirm delivery via FDC proof and call MissionControl.confirmDelivery().
    
    Returns the tx hash on success, None on failure.
    """
    if not is_chain_configured():
        logger.warning("Chain not configured — skipping confirmDelivery")
        return None

    try:
        _, _, mission_control, _ = get_chain()
        proof, root, leaf = _mock_merkle_proof(request_id, "delivery_confirmed")

        receipt = await send_tx(
            mission_control.functions.confirmDelivery,
            request_id, proof, root, leaf
        )
        tx_hash = receipt.transactionHash.hex()
        logger.info(f"confirmDelivery #{request_id} confirmed — tx {tx_hash}")
        log_chain_event("MissionComplete", request_id, tx_hash)
        return tx_hash

    except Exception as e:
        logger.error(f"confirmDelivery #{request_id} failed: {e}")
        return None
