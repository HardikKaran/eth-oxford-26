"""
approval_flow.py — LLM-driven allocation decision + on-chain approveAid().

After verifyEvent succeeds (status = EVENT_VERIFIED), this module makes
the allocation decision and calls MissionControl.approveAid().
"""

import os
import json
import logging

from langchain_groq import ChatGroq
from chain import get_chain, send_tx, is_chain_configured, log_chain_event

logger = logging.getLogger("aegis.approval")


async def run_approval(request_id: int, lat: float, lng: float, description: str, disaster_name: str) -> str | None:
    """
    Run the LLM allocation decision and call approveAid() on-chain.
    
    Returns the tx hash on success, None on failure.
    """
    if not is_chain_configured():
        logger.warning("Chain not configured — skipping approveAid")
        return None

    try:
        # LLM allocation decision (single call, NOT the full 5-agent debate)
        groq_key = os.getenv("GROQ_API_KEY")
        llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0.3, api_key=groq_key)

        prompt = (
            f"A disaster has been verified at ({lat}, {lng}): {disaster_name}.\n"
            f"The victim requested: {description}\n\n"
            f"Recommend:\n"
            f"1. Provider type (Drone / Ground Vehicle / Human Team)\n"
            f"2. Estimated cost in whole USD (realistic, between 20 and 500)\n\n"
            f'Respond ONLY in JSON: {{"provider_type": "...", "cost_usd": 50}}'
        )

        res = llm.invoke(prompt)
        raw = res.content.strip()

        # Parse JSON from response (handle markdown code blocks)
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        allocation = json.loads(raw)
        cost_usd = int(allocation.get("cost_usd", 50))
        provider_type = allocation.get("provider_type", "Drone")

        logger.info(f"LLM allocation: {provider_type}, ${cost_usd} for request #{request_id}")

        # Get provider address from env (fixed for demo)
        provider_address = os.getenv("PROVIDER_ADDRESS")
        if not provider_address:
            # Default to oracle address if not set
            _, account, _, _ = get_chain()
            provider_address = account.address

        # Call approveAid on-chain
        _, _, mission_control, _ = get_chain()
        receipt = await send_tx(
            mission_control.functions.approveAid,
            request_id,
            provider_address,
            cost_usd
        )
        tx_hash = receipt.transactionHash.hex()
        logger.info(f"approveAid #{request_id} confirmed — tx {tx_hash}")
        log_chain_event("AidApproved", request_id, tx_hash)
        return tx_hash

    except Exception as e:
        logger.error(f"approveAid #{request_id} failed: {e}")
        return None
