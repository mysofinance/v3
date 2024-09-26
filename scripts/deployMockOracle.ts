import { ethers } from "hardhat";
import { getNetworkInfo } from "./utils";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH\n`);

  const [CHAIN_ID, NETWORK_NAME] = await getNetworkInfo();
  console.log("Current chain ID:", CHAIN_ID);
  console.log("Current NETWORK_NAME:", NETWORK_NAME);
  console.log("");

  const MockOracle = await ethers.getContractFactory("MockOracle");
  const mockOracle = await MockOracle.deploy();
  console.log(`* Mock Oracle: ${mockOracle.target}`);

  console.log("\nContract deployment complete.");
  console.log("Next, verify the contracts using the following commands:");
  console.log(
    `npx hardhat verify --network ${NETWORK_NAME} "${mockOracle.target}"`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
