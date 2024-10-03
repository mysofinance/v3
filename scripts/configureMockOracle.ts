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

async function setOraclePrice(
  mockOracle: any,
  underlyingTokenAddr: string,
  settlementTokenAddr: string,
  price: string,
  decimals: number,
  deployer: any
) {
  const formattedPrice = ethers.parseUnits(price, decimals);
  await mockOracle
    .connect(deployer)
    .setPrice(underlyingTokenAddr, settlementTokenAddr, formattedPrice);
  console.log(
    `Price of ${price} (with ${decimals} decimals) set for underlying token ${underlyingTokenAddr} vs settlement token ${settlementTokenAddr}`
  );
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

  // Get the deployed Mock Oracle
  const mockOracleAddress = await askQuestion(
    "Enter the Mock Oracle contract address: "
  );
  const MockOracle = await ethers.getContractFactory("MockOracle");
  const mockOracle = await MockOracle.attach(mockOracleAddress);

  let continueConfig = true;

  while (continueConfig) {
    // Addresses for tokens
    const settlementTokenAddr = await askQuestion(
      "Enter the settlement token address: "
    );
    const underlyingTokenAddr = await askQuestion(
      "Enter the underlying token address: "
    );

    // Ask for price and decimals
    const price = await askQuestion("Enter the price (e.g., 5.7): ");
    const decimals = parseInt(
      await askQuestion("Enter the decimals (e.g., 18): "),
      10
    );

    console.log(`\nYou entered:\nPrice: ${price}\nDecimals: ${decimals}`);
    const confirm = await askQuestion(
      "Proceed with setting the price? (yes/no): "
    );

    if (confirm.toLowerCase() === "yes") {
      await setOraclePrice(
        mockOracle,
        underlyingTokenAddr,
        settlementTokenAddr,
        price,
        decimals,
        deployer
      );
      console.log("\nPrice successfully set.");
    }

    const continueAnswer = await askQuestion(
      "Would you like to set another price? (yes/no): "
    );
    if (continueAnswer.toLowerCase() !== "yes") {
      continueConfig = false;
    }
  }

  rl.close();
  console.log("Price configuration process finished.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
