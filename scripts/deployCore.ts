import hre from "hardhat";
import { askQuestion, closeReadline, getNetworkInfo } from "./utils.js";

async function main() {
  const { ethers } = await hre.network.connect();

  const [deployer] = await ethers.getSigners();
  console.log("Deployer account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH\n`);

  const [CHAIN_ID, NETWORK_NAME] = await getNetworkInfo();
  console.log("Current chain ID:", CHAIN_ID);
  console.log("Current NETWORK_NAME:", NETWORK_NAME);
  console.log("");

  const owner = await askQuestion("Enter the owner address: ");

  console.log("\nDeployment parameters:");
  console.log("Owner:", owner);

  const confirm = await askQuestion("Proceed with Core deployment? (yes/no): ");

  if (confirm.toLowerCase() === "yes") {
    // Deploy Escrow implementation
    const Escrow = await ethers.getContractFactory("Escrow");
    const escrowImpl = await Escrow.deploy();
    console.log(`* Escrow implementation: ${escrowImpl.target}`);

    // Deploy Router contract
    const Router = await ethers.getContractFactory("Router");
    const router = await Router.deploy(owner, escrowImpl.target);
    console.log(`* Router: ${router.target}`);

    console.log("\nContract deployment complete.");
    console.log("Next, verify the contracts using the following commands:");
    console.log(
      `npx hardhat verify --network ${NETWORK_NAME} "${escrowImpl.target}"`,
    );
    console.log(
      `npx hardhat verify --network ${NETWORK_NAME} "${router.target}" "${owner}" "${escrowImpl.target}"`,
    );
  } else {
    console.log("Deployment cancelled.");
  }

  closeReadline();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
