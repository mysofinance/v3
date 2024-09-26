import { ethers } from "hardhat";
import { getNetworkInfo } from "./utils";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function askQuestion(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function deployFeeHandler(routerAddr: string, deployer: any) {
  // Deploy Fee Handler
  const FeeHandler = await ethers.getContractFactory("FeeHandler");
  const feeHandler = await FeeHandler.deploy(
    deployer.address,
    routerAddr,
    ethers.parseEther("0.1"), // Match Fee
    0, // Distribution partner fee share
    0 // Exercise fee
  );
  console.log(`* Fee Handler: ${feeHandler.target}`);

  return feeHandler;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH\n`);

  const [CHAIN_ID, NETWORK_NAME] = await getNetworkInfo();
  console.log("Current chain ID:", CHAIN_ID);
  console.log("Current NETWORK_NAME:", NETWORK_NAME);
  console.log("");

  const routerAddr = await askQuestion("Enter the Router contract address: ");

  console.log(`You entered:\nRouter Address: ${routerAddr}`);
  const confirm = await askQuestion(
    "Proceed with Fee Handler deployment? (yes/no): "
  );

  if (confirm.toLowerCase() === "yes") {
    const feeHandler = await deployFeeHandler(routerAddr, deployer);

    console.log("\nContract deployment complete.");
    console.log("Next, verify the contracts using the following command:");
    console.log(
      `npx hardhat verify --network ${NETWORK_NAME} "${feeHandler.target}" "${deployer.address}" "${routerAddr}" "${ethers.parseEther("0.1")}" 0 0`
    );
  } else {
    console.log("Deployment cancelled.");
  }

  rl.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
