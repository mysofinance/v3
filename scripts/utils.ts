import hre from "hardhat";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export async function askQuestion(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

export function closeReadline() {
  rl.close();
}

export async function getNetworkInfo(): Promise<[bigint, string]> {
  const { ethers } = await hre.network.connect();
  const network = await ethers.provider.getNetwork();

  switch (network.chainId) {
    case BigInt(1):
      return [network.chainId, "mainnet"];
    case BigInt(11155111):
      return [network.chainId, "sepolia"];
    case BigInt(31337):
      return [network.chainId, "localhost"];
    default:
      return [
        network.chainId,
        `Unknown network (chain ID: ${network.chainId})`,
      ];
  }
}
