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

async function deployToken(
  tokenName: string,
  tokenSymbol: string,
  tokenDecimals: number,
  deployer: any
) {
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy(tokenName, tokenSymbol, tokenDecimals);
  console.log(
    `* Token deployed: ${token.target} (${tokenName}, ${tokenSymbol}, Decimals: ${tokenDecimals})`
  );

  // Mint tokens for the deployer
  await token.mint(deployer.address, ethers.parseUnits("1000", tokenDecimals));
  console.log(`Minted 1000 ${tokenSymbol} for ${deployer.address}`);

  return token;
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

  let continueDeploy = true;

  while (continueDeploy) {
    const tokenName = await askQuestion("Enter the token name: ");
    const tokenSymbol = await askQuestion("Enter the token symbol: ");
    const tokenDecimals = parseInt(
      await askQuestion("Enter the token decimals (e.g., 18): "),
      10
    );

    console.log(
      `\nYou entered:\nToken Name: ${tokenName}\nToken Symbol: ${tokenSymbol}\nDecimals: ${tokenDecimals}`
    );
    const confirm = await askQuestion("Proceed with deployment? (yes/no): ");

    if (confirm.toLowerCase() === "yes") {
      const token = await deployToken(
        tokenName,
        tokenSymbol,
        tokenDecimals,
        deployer
      );

      console.log("\nContract deployment complete.");
      console.log("Next, verify the contract using the following command:");
      console.log(
        `npx hardhat verify --network ${NETWORK_NAME} "${token.target}" "${tokenName}" "${tokenSymbol}" "${tokenDecimals}"`
      );
    }

    const continueAnswer = await askQuestion(
      "Would you like to deploy another token? (yes/no): "
    );
    if (continueAnswer.toLowerCase() !== "yes") {
      continueDeploy = false;
    }
  }

  rl.close();
  console.log("Token deployment process finished.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
