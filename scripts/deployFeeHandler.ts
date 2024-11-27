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
  owner: string,
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
  console.log("Deployer account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH\n`);

  const [CHAIN_ID, NETWORK_NAME] = await getNetworkInfo();
  console.log("Current chain ID:", CHAIN_ID);
  console.log("Current NETWORK_NAME:", NETWORK_NAME);
  console.log("");

  const routerAddr = await askQuestion("Enter the Router contract address: ");

  const matchFeeInput = await askQuestion(
    "Enter the Match Fee percentage (e.g., 10 for 10%): "
  );
  const matchFee = ethers.parseUnits(matchFeeInput, 16);

  const exerciseFeeInput = await askQuestion(
    "Enter the Exercise Fee percentage (e.g., 0.1 for 0.1%): "
  );
  const exerciseFee = ethers.parseUnits(exerciseFeeInput, 16);

  const mintFeeInput = await askQuestion(
    "Enter the Mint Fee percentage (e.g., 1 for 1%): "
  );
  const mintFee = ethers.parseUnits(mintFeeInput, 16);

  console.log("\nDeployment parameters:");
  console.log("Router Address:", routerAddr);
  console.log("Owner:", owner);
  console.log("Match Fee (18 decimals):", matchFee.toString());
  console.log("Exercise Fee (18 decimals):", exerciseFee.toString());
  console.log("Mint Fee (18 decimals):", mintFee.toString());

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
