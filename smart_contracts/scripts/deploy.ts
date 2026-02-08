import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Starting Deployment to Coston2...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // --- 1. Deploy Mocks (So we have controlled tokens) ---
  const MockToken = await ethers.getContractFactory("MockToken");
  const fxrp = await MockToken.deploy("Mock FXRP", "FXRP");
  await fxrp.waitForDeployment();
  console.log("✅ Mock FXRP deployed to:", await fxrp.getAddress());

  const usdc = await MockToken.deploy("Mock USDC", "USDC");
  await usdc.waitForDeployment();
  console.log("✅ Mock USDC deployed to:", await usdc.getAddress());

  const MockDex = await ethers.getContractFactory("MockDexRouter");
  const dex = await MockDex.deploy();
  await dex.waitForDeployment();
  console.log("✅ Mock Dex Router deployed to:", await dex.getAddress());

  // --- 2. Deploy Identity Registry ---
  const Identity = await ethers.getContractFactory("IdentityRegistry");
  const identity = await Identity.deploy();
  await identity.waitForDeployment();
  console.log("✅ IdentityRegistry deployed to:", await identity.getAddress());

  // --- 3. Deploy Treasury ---
  // Note: We use the MOCK Tokens, but the REAL Flare Registry? 
  // Actually, we pass the real registry address to the constructor.
  // Coston2 Registry Address: 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019
  const COSTON2_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
  
  const Treasury = await ethers.getContractFactory("AidTreasury");
  const treasury = await Treasury.deploy(
    await dex.getAddress(),
    await fxrp.getAddress(),
    await usdc.getAddress(),
    COSTON2_REGISTRY // <--- This connects us to the REAL FTSO!!
  );
  await treasury.waitForDeployment();
  console.log("✅ AidTreasury deployed to:", await treasury.getAddress());

  // --- 4. Deploy Mission Control ---
  const MissionControl = await ethers.getContractFactory("MissionControl");
  const missionControl = await MissionControl.deploy(
    await identity.getAddress(),
    await treasury.getAddress(),
    deployer.address, // We set YOU as the LLM Oracle for the demo
    COSTON2_REGISTRY // <--- This connects us to the REAL FDC!!
  );
  await missionControl.waitForDeployment();
  console.log("✅ MissionControl deployed to:", await missionControl.getAddress());

  // --- 5. Wiring & Setup ---
  console.log("🔧 Wiring contracts together...");
  
  // Authorize MissionControl to spend Treasury funds
  await treasury.setMissionControl(await missionControl.getAddress());
  
  // Verify the deployer (you) so you can test the frontend immediately
  await identity.addVerifiedUser(deployer.address);

  // Fund the DEX so swaps actually work (Simulate Liquidity)
  // We give the DEX 10,000 USDC so it can pay out aid
  await usdc.transfer(await dex.getAddress(), ethers.parseEther("10000"));

  // Fund the Treasury with FXRP (The "Donations")
  await fxrp.transfer(await treasury.getAddress(), ethers.parseEther("5000"));

  console.log("🎉 Deployment Complete! Copy these addresses to your Frontend.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});