import { ethers } from "hardhat";
import { getNetworkInfo } from "./utils"; // Import utility
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function askQuestion(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function configureRouter(
  routerAddr: string,
  feeHandlerAddr: string,
  deployer: any
) {
  // Get the deployed Router
  const Router = await ethers.getContractFactory("Router");
  const router: any = await Router.attach(routerAddr);

  // Set Fee Handler
  await router.connect(deployer).setFeeHandler(feeHandlerAddr);
  console.log(`Fee Handler set for Router at ${routerAddr}`);
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

  let continueConfigure = true;

  while (continueConfigure) {
    const routerAddr = await askQuestion("Enter the Router contract address: ");
    const feeHandlerAddr = await askQuestion(
      "Enter the Fee Handler contract address: "
    );

    console.log(
      `\nYou entered:\nRouter Address: ${routerAddr}\nFee Handler Address: ${feeHandlerAddr}`
    );
    const confirm = await askQuestion("Proceed with configuration? (yes/no): ");

    if (confirm.toLowerCase() === "yes") {
      await configureRouter(routerAddr, feeHandlerAddr, deployer);

      console.log("\nConfiguration complete.");
      console.log("Next, verify the contracts using the following command:");
      console.log(
        `npx hardhat verify --network ${NETWORK_NAME} "${routerAddr}" "${feeHandlerAddr}"`
      );
    }

    const continueAnswer = await askQuestion(
      "Would you like to continue configuring the router? (yes/no): "
    );
    if (continueAnswer.toLowerCase() !== "yes") {
      continueConfigure = false;
    }
  }

  rl.close();
  console.log("Router configuration process finished.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
