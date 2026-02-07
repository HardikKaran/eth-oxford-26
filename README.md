# eth-oxford-26

## Prerequisites
- node.js (v18+)
- Python (3.10+)
- Metamask (connected to Coston2 Testnet)
- Coston2 $C2FLR tokens
- OpenAI, Gemini, Claude API key
- USGS Earthquake API & NASA FIRMS (for wildfires)

## Idea
90% deterministic models, 10% LLM. Deterministic will buy/sell - use a formula called Constant Product Market Maker (xy = k, x = YES, y = NO). LLMs use different models (Claude, Gemini, ChatGPT) with different personalities. Smart contracts - master wallet that acts as a fund for the agents and only use a specified amount of money - deterministic models have less cash than LLMs because they are generating liquidity and noise.

## Tech Stack
- Blockchain: Flare Network (Coston2 Testnet), Solidity, Hardhat.
- Data Oracle: Flare FDC (JsonApi Attestation Type).
- AI Swarm: Python, LangGraph, OpenAI GPT-5.1, Anthropic Claude Sonnet 4.5, Google Gemini 3.0.
- Backend: Node.js (for FDC interactions), Python (for Agents).
- Frontend: Next.js (Dashboard for visualization).

## Description
Aegis is a decentralised, autonomous disaster response system. When a disaster strikes (e.g., a high-magnitude earthquake), speed is critical. Traditional aid is often delayed by verification lags and manual resource allocation. Aegis solves this by:

1. Listening: A monitoring service watches verified data sources.
2. Verifying: Using Flare's FDC, we prove cryptographically on-chain that a disaster occurred at specific coordinates with a specific severity.
3. Mobilising: This on-chain signal wakes up a LangGraph Agent Swarm.
- Scout Agent: Analyzes terrain and population density.
- Logistics Agent: Plots drone flight paths for supply drops.
- Treasury Agent: Calculates the required funds based on severity.
4. Executing: The swarm proposes a transaction. If it matches the FDC data, the Smart Contract automatically unlocks funds (or $fXRP) to the relief teams/drones.
