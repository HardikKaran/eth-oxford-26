# eth-oxford-26

## Prerequisites
- node.js (v18+)
- Python (3.10+)
- Metamask (connected to Coston2 Testnet)
- Coston2 $C2FLR tokens
- Groq API Key
- GDACS & EONET API

## Idea
Aegis is a decentralised, autonomous disaster response system. When a disaster strikes (e.g., a high-magnitude earthquake), speed is critical. Traditional aid is often delayed by verification lags and manual resource allocation. Aegis solves this by:
- Listening: A monitoring service watches verified data sources (USGS).
- Verifying: Using Flare's FDC, we prove cryptographically on-chain that a disaster occurred at specific coordinates with a specific severity.
- Mobilising: This on-chain signal wakes up a LangGraph Agent Swarm.
  🕵️ Scout Agent: Analyses terrain and population density.
  🚚 Logistics Agent: Plots drone flight paths for supply drops.
  💰 Treasury Agent: Calculates the required funds based on severity.
- Executing: The swarm proposes a transaction. If it matches the FDC data, the Smart Contract automatically unlocks funds (or $fXRP) to the relief teams/drones.

## Tech Stack
- Blockchain: Flare Network (Coston2 Testnet), Solidity, Hardhat.
- Data Oracle: Flare FDC (JsonApi Attestation Type).
- AI Swarm: Python, LangGraph, Groq.
- Backend: Node.js (for FDC interactions), Python (for Agents).
- Frontend: Next.js (Dashboard for visualisation).

## Description
Aegis is a decentralised, autonomous disaster response system. When a disaster strikes (e.g., a high-magnitude earthquake), speed is critical. Traditional aid is often delayed by verification lags and manual resource allocation. Aegis solves this by:

1. Listening: A monitoring service watches verified data sources.
2. Verifying: Using Flare's FDC, we prove cryptographically on-chain that a disaster occurred at specific coordinates with a specific severity.
3. Mobilising: This on-chain signal wakes up a LangGraph Agent Swarm.
- Scout Agent: Analyzes terrain and population density.
- Logistics Agent: Plots drone flight paths for supply drops.
- Treasury Agent: Calculates the required funds based on severity.
4. Executing: The swarm proposes a transaction. If it matches the FDC data, the Smart Contract automatically unlocks funds (or $fXRP) to the relief teams/drones.

## Feedback: Building on Flare
Building Aegis on the Flare Network was a unique experience compared to standard EVM chains. Here are our key takeaways:
- The FDC is powerful but nuanced: The Flare Data Connector (FDC) fundamentally changes how we think about oracles. Instead of trusting a centralized feeder, we could essentially "prove" USGS data directly. The JsonApi attestation type is incredibly flexible, though debugging the exact JSON path (JQ filter) required some trial and error during the hackathon.
- Latency Considerations: We had to architect our "Real-Time" dashboard to account for the FDC's voting rounds (~90 seconds). This influenced our UX choice to have a "Verifying..." state in the UI, which actually added to the sense of security and trust for the user.
- Developer Experience: The flare-hardhat-config and coston2 faucet were reliable. The documentation for FDC verification (specifically the hex encoding of attestation bodies) was helpful, though more examples of "Complex JSON parsing" would speed up future hackathon teams.
- Value Proposition: For a high-stakes use case like Disaster Relief, Flare's model of "Enshrined Data" provides a layer of legal/trust safety that a standard oracle contract cannot match. It makes the "Autonomous Firm" concept viable.
