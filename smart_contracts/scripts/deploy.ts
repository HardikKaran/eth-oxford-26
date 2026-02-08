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

  // --- 1b. Deploy Mock FDC Verification + Mock Contract Registry ---
  const MockFdc = await ethers.getContractFactory("MockFdcVerification");
  const fdc = await MockFdc.deploy();
  await fdc.waitForDeployment();
  console.log("✅ MockFdcVerification deployed to:", await fdc.getAddress());

  const MockRegistry = await ethers.getContractFactory("MockContractRegistry");
  const mockRegistry = await MockRegistry.deploy();
  await mockRegistry.waitForDeployment();
  console.log("✅ MockContractRegistry deployed to:", await mockRegistry.getAddress());

  // Register the mock FDC in the mock registry
  await mockRegistry.setContractAddress("FdcVerification", await fdc.getAddress());
  console.log("   → Registered FdcVerification in MockContractRegistry");

  // Deploy and register Mock FTSO Registry (for Treasury price feeds)
  const MockFtso = await ethers.getContractFactory("MockFtsoRegistry");
  const ftso = await MockFtso.deploy();
  await ftso.waitForDeployment();
  console.log("✅ MockFtsoRegistry deployed to:", await ftso.getAddress());

  await mockRegistry.setContractAddress("FtsoRegistry", await ftso.getAddress());
  console.log("   → Registered FtsoRegistry in MockContractRegistry");

  // --- 2. Deploy Identity Registry ---
  const Identity = await ethers.getContractFactory("IdentityRegistry");
  const identity = await Identity.deploy();
  await identity.waitForDeployment();
  console.log("✅ IdentityRegistry deployed to:", await identity.getAddress());

  // --- 3. Deploy Treasury ---
  // Uses our mock registry since the FTSO price feed isn't needed for the demo
  const Treasury = await ethers.getContractFactory("AidTreasury");
  const treasury = await Treasury.deploy(
    await dex.getAddress(),
    await fxrp.getAddress(),
    await usdc.getAddress(),
    await mockRegistry.getAddress()
  );
  await treasury.waitForDeployment();
  console.log("✅ AidTreasury deployed to:", await treasury.getAddress());

  // --- 4. Deploy Mission Control ---
  const MissionControl = await ethers.getContractFactory("MissionControl");
  const missionControl = await MissionControl.deploy(
    await identity.getAddress(),
    await treasury.getAddress(),
    deployer.address, // We set YOU as the LLM Oracle for the demo
    await mockRegistry.getAddress() // Uses MockContractRegistry → MockFdcVerification
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

  console.log("\n🎉 Deployment Complete! Copy these addresses to your backend/.env:");
  console.log(`   MISSION_CONTROL_ADDRESS=${await missionControl.getAddress()}`);
  console.log(`   AID_TREASURY_ADDRESS=${await treasury.getAddress()}`);
  console.log(`   IDENTITY_REGISTRY_ADDRESS=${await identity.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});