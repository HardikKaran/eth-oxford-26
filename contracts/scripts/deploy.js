const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // ─── 1. Deploy a mock USDC for testing (skip on mainnet) ─────────────
  // In production, use the actual USDC/USDT contract address
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("MockUSDC deployed to:", usdcAddr);

  // ─── 2. Deploy VerificationRegistry ──────────────────────────────────
  // address(0) for zkVerifier = dev mode (accepts any proof)
  const VerificationRegistry = await ethers.getContractFactory("VerificationRegistry");
  const registry = await VerificationRegistry.deploy(ethers.ZeroAddress);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("VerificationRegistry deployed to:", registryAddr);

  // ─── 3. Deploy FundPool ──────────────────────────────────────────────
  const FundPool = await ethers.getContractFactory("FundPool");
  const fundPool = await FundPool.deploy(usdcAddr);
  await fundPool.waitForDeployment();
  const fundPoolAddr = await fundPool.getAddress();
  console.log("FundPool deployed to:", fundPoolAddr);

  // ─── 4. Deploy AidChain ──────────────────────────────────────────────
  const oracleOperator = deployer.address; // deployer acts as oracle in dev
  const AidChain = await ethers.getContractFactory("AidChain");
  const aidChain = await AidChain.deploy(oracleOperator, fundPoolAddr, registryAddr);
  await aidChain.waitForDeployment();
  const aidChainAddr = await aidChain.getAddress();
  console.log("AidChain deployed to:", aidChainAddr);

  // ─── 5. Wire contracts together ──────────────────────────────────────
  await fundPool.setAidChainContract(aidChainAddr);
  console.log("FundPool → AidChain linked");

  // Set deployer as panel operator for testing
  await aidChain.setPanelOperator(deployer.address, true);
  console.log("Deployer set as panel operator");

  // ─── 6. Print summary ────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════");
  console.log("  AidChain Deployment Complete");
  console.log("═══════════════════════════════════════");
  console.log(`  MockUSDC:              ${usdcAddr}`);
  console.log(`  VerificationRegistry:  ${registryAddr}`);
  console.log(`  FundPool:              ${fundPoolAddr}`);
  console.log(`  AidChain:              ${aidChainAddr}`);
  console.log(`  Oracle Operator:       ${deployer.address}`);
  console.log("═══════════════════════════════════════\n");

  return { usdc: usdcAddr, registry: registryAddr, fundPool: fundPoolAddr, aidChain: aidChainAddr };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
