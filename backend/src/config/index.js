import dotenv from "dotenv";
dotenv.config();

const config = {
  port: parseInt(process.env.PORT || "3001"),
  env: process.env.NODE_ENV || "development",

  // Blockchain
  rpcUrl: process.env.XRPL_EVM_RPC_URL || "https://rpc.testnet.xrplevm.org",
  chainId: parseInt(process.env.CHAIN_ID || "1449000"),
  oraclePrivateKey: process.env.ORACLE_PRIVATE_KEY,

  // Contract addresses
  contracts: {
    aidChain: process.env.AIDCHAIN_CONTRACT,
    fundPool: process.env.FUNDPOOL_CONTRACT,
    registry: process.env.REGISTRY_CONTRACT,
    usdc: process.env.USDC_CONTRACT,
  },

  // Auth
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",

  // LLM Panel
  llmNodes: [
    { id: "alpha", name: "Sentinel-α", model: "Llama-3.3-70B", url: process.env.LLM_NODE_ALPHA_URL },
    { id: "beta", name: "Sentinel-β", model: "Mistral-Large", url: process.env.LLM_NODE_BETA_URL },
    { id: "gamma", name: "Sentinel-γ", model: "Qwen-72B", url: process.env.LLM_NODE_GAMMA_URL },
    { id: "delta", name: "Sentinel-δ", model: "DeepSeek-V3", url: process.env.LLM_NODE_DELTA_URL },
    { id: "epsilon", name: "Sentinel-ε", model: "Claude-3.5", url: process.env.LLM_NODE_EPSILON_URL },
  ],

  // External services
  galileoEndpoint: process.env.GALILEO_OSNMA_ENDPOINT,
  gdacsApiUrl: process.env.GDACS_API_URL || "https://www.gdacs.org/gdacsapi/api/events",
  ziplineApiUrl: process.env.ZIPLINE_API_URL,
  flareFdcEndpoint: process.env.FLARE_FDC_ENDPOINT,

  // XRPL native (for FXRP swap)
  xrplWss: process.env.XRPL_MAINNET_WSS || "wss://s1.ripple.com",
  xrplWalletSeed: process.env.XRPL_WALLET_SEED,
};

export default config;
