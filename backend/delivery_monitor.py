"""
delivery_monitor.py — Simulated delivery confirmation + Treasury payout.

After MissionControl.approveAid() succeeds (status = APPROVED), this module
waits a configurable delay (simulating drone/vehicle travel), then calls
confirmDelivery() and triggers the Treasury payout.
"""

import asyncio
import logging

from chain import get_chain, send_tx, is_chain_configured, log_chain_event
from fdc_client import confirm_delivery

logger = logging.getLogger("aegis.delivery")

# Simulated delivery time in seconds (45-60s for demo realism)
DELIVERY_DELAY_SECONDS = 50


async def schedule_delivery(request_id: int) -> str | None:
    """
    Background task: wait for simulated delivery, then confirm on-chain.
    
    1. Wait DELIVERY_DELAY_SECONDS (simulating drone flight)
    2. Call MissionControl.confirmDelivery() via fdc_client
    3. Trigger AidTreasury.processPayout() if treasury is configured
    
    Returns the confirmDelivery tx hash on success, None on failure.
    """
    if not is_chain_configured():
        logger.warning("Chain not configured — skipping delivery")
        return None

    logger.info(f"Delivery #{request_id}: waiting {DELIVERY_DELAY_SECONDS}s for simulated delivery...")
    await asyncio.sleep(DELIVERY_DELAY_SECONDS)

    # Confirm delivery on-chain
    tx_hash = await confirm_delivery(request_id)
    if not tx_hash:
        logger.error(f"Delivery #{request_id}: confirmDelivery failed")
        return None

    logger.info(f"Delivery #{request_id}: confirmed — tx {tx_hash}")

    # Trigger treasury payout
    await _trigger_payout(request_id)

    return tx_hash


async def _trigger_payout(request_id: int):
    """
    After delivery is confirmed, trigger AidTreasury.processPayout()
    to compensate the aid provider.
    """
    try:
        _, _, mission_control, aid_treasury = get_chain()

        if not aid_treasury:
            logger.info(f"Payout #{request_id}: no treasury configured — skipping")
            return

        # Read approved cost and provider from the on-chain request
        result = mission_control.functions.requests(request_id).call()
        provider = result[3]
        cost_usd = result[4]

        if cost_usd == 0:
            logger.info(f"Payout #{request_id}: cost is 0 — skipping payout")
            return

        receipt = send_tx(aid_treasury.functions.processPayout, provider, cost_usd)
        payout_tx = receipt.transactionHash.hex()
        logger.info(f"Payout #{request_id}: ${cost_usd} to {provider} — tx {payout_tx}")
        log_chain_event("PayoutProcessed", request_id, payout_tx)

    except Exception as e:
        logger.error(f"Payout #{request_id} failed: {e}")
