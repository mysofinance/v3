import { defineConfig, configVariable } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    profiles: {
      default: {
        version: "0.8.24",
        settings: {
          // without optimizer, the bytecode is too large to be deployed for tests
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
      production: {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        },
      },
    },
  },
  networks: {
    sepolia: {
      type: "http",
      chainId: 11155111,
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_DEPLOYER_KEY")],
    },
    mainnet: {
      type: "http",
      chainId: 1,
      url: configVariable("MAINNET_RPC_URL"),
      accounts: [configVariable("MAINNET_DEPLOYER_KEY")],
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
});
