"""
delivery_monitor.py — Simulated delivery confirmation.

After MissionControl.approveAid() succeeds (status = APPROVED), this module
waits a configurable delay (simulating drone/vehicle travel), then calls
confirmDelivery() which triggers the Treasury payout internally in Solidity.

NOTE: MissionControl.confirmDelivery() already calls treasury.processPayout()
on-chain. We do NOT call processPayout separately — that would revert.
"""

import asyncio
import logging

from chain import is_chain_configured
from fdc_client import confirm_delivery

logger = logging.getLogger("aegis.delivery")

# Simulated delivery time in seconds (45-60s for demo realism)
DELIVERY_DELAY_SECONDS = 30


async def schedule_delivery(request_id: int) -> str | None:
    """
    Background task: wait for simulated delivery, then confirm on-chain.

    1. Wait DELIVERY_DELAY_SECONDS (simulating drone flight)
    2. Call MissionControl.confirmDelivery() via fdc_client
       → Solidity internally calls AidTreasury.processPayout()

    Returns the confirmDelivery tx hash on success, None on failure.
    """
    if not is_chain_configured():
        logger.warning("Chain not configured — skipping delivery")
        return None

    logger.info(f"Delivery #{request_id}: waiting {DELIVERY_DELAY_SECONDS}s for simulated delivery...")
    await asyncio.sleep(DELIVERY_DELAY_SECONDS)

    # Confirm delivery on-chain (this triggers payout automatically in the contract)
    tx_hash = await confirm_delivery(request_id)
    if not tx_hash:
        logger.error(f"Delivery #{request_id}: confirmDelivery failed")
        return None

    logger.info(f"Delivery #{request_id}: confirmed and paid — tx {tx_hash}")
    return tx_hash
