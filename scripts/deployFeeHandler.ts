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

async function deployFeeHandler(
  routerAddr: string,
  owner: any,
  matchFee: any,
  exerciseFee: any,
  mintFee: any
) {
  // Deploy Fee Handler
  const FeeHandler = await ethers.getContractFactory("FeeHandler");
  const feeHandler = await FeeHandler.deploy(
    owner,
    matchFee,
    exerciseFee,
    mintFee
  );
  console.log(`* Fee Handler: ${feeHandler.target}`);

  return feeHandler;
}

async function main() {
  const [deployer] = await ethers.getSigners();

  const owner = deployer.address;
  const matchFee = ethers.parseUnits("0.125", 18);
  const exerciseFee = ethers.parseUnits("0.001", 18);
  const mintFee = ethers.parseUnits("0.01", 18);
  console.log("Deployment parameters");
  console.log("owner: ", owner);
  console.log("matchFee: ", matchFee);
  console.log("exerciseFee: ", exerciseFee);
  console.log("mintFee: ", mintFee);

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
    const feeHandler = await deployFeeHandler(
      routerAddr,
      owner,
      matchFee,
      exerciseFee,
      mintFee
    );

    console.log("\nContract deployment complete.");
    console.log("Next, verify the contracts using the following command:");
    console.log(
      `npx hardhat verify --network ${NETWORK_NAME} "${feeHandler.target}" "${owner}" "${matchFee}" "${exerciseFee}" "${mintFee}"`
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
