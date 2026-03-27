import hre from "hardhat";
import { askQuestion, closeReadline, getNetworkInfo } from "./utils.js";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { MockOracle } from "../types/ethers-contracts/index.js";

async function getTokenDecimals(
  tokenAddress: string,
  deployer: HardhatEthersSigner,
): Promise<bigint> {
  const { ethers } = await hre.network.connect();

  try {
    const ERC20 = await ethers.getContractAt(
      "MockERC20",
      tokenAddress,
      deployer,
    );
    const decimals = await ERC20.decimals();
    return decimals;
  } catch (error) {
    console.error(
      `Error fetching decimals for token at address ${tokenAddress}:`,
      error,
    );
    throw new Error("Failed to retrieve token decimals.");
  }
}

async function setOraclePrice(
  mockOracle: MockOracle,
  underlyingTokenAddr: string,
  settlementTokenAddr: string,
  priceStr: string,
  priceParsed: bigint,
  deployer: HardhatEthersSigner,
) {
  await mockOracle
    .connect(deployer)
    .setPrice(underlyingTokenAddr, settlementTokenAddr, priceParsed);
  console.log(
    `Price of ${priceStr} (=${priceParsed}) set for 1 unit of underlying token ${underlyingTokenAddr} vs settlement token ${settlementTokenAddr}`,
  );
}

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

  // Get the deployed Mock Oracle
  const mockOracleAddress = await askQuestion(
    "Enter the Mock Oracle contract address: ",
  );
  const MockOracle = await ethers.getContractFactory("MockOracle");
  const mockOracle = await MockOracle.attach(mockOracleAddress);

  let continueConfig = true;

  while (continueConfig) {
    // Addresses for tokens
    const settlementTokenAddr = await askQuestion(
      "Enter the settlement token address: ",
    );
    const underlyingTokenAddr = await askQuestion(
      "Enter the underlying token address: ",
    );

    try {
      console.log("Fetching token decimals...");
      const underlyingDecimals = await getTokenDecimals(
        underlyingTokenAddr,
        deployer,
      );
      const settlementDecimals = await getTokenDecimals(
        settlementTokenAddr,
        deployer,
      );

      console.log(
        `Decimals fetched: \nUnderlying token decimals: ${underlyingDecimals}\nSettlement token decimals: ${settlementDecimals}`,
      );

      // Ask for price
      const price = await askQuestion(
        `Enter the price (i.e., settlement token amount for 1**${underlyingDecimals} unit of underlying token; e.g., 5.7): `,
      );
      const priceParsed = ethers.parseUnits(price, settlementDecimals);
      console.log(`\nYou entered:\nPrice: ${price} (=${priceParsed})`);
      const confirm = await askQuestion(
        "Proceed with setting the price? (yes/no): ",
      );

      if (confirm.toLowerCase() === "yes") {
        await setOraclePrice(
          mockOracle,
          underlyingTokenAddr,
          settlementTokenAddr,
          price,
          priceParsed,
          deployer,
        );
        console.log("\nPrice successfully set.");
      }
    } catch (error) {
      console.error("Error setting price:", error);
    }

    const continueAnswer = await askQuestion(
      "Would you like to set another price? (yes/no): ",
    );
    if (continueAnswer.toLowerCase() !== "yes") {
      continueConfig = false;
    }
  }

  closeReadline();
  console.log("Price configuration process finished.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
