# Forked Network Testing with Hardhat

This guide walks you through setting up and running forked tests using Hardhat.

## Step 1: Enable Forking in `hardhat.config.ts`

Uncomment the following section in the Hardhat configuration file to enable mainnet (or any network) forking:

```ts
hardhat: {
  forking: {
    url: RPC_ENDPOINT, // e.g., process.env.MAINNET_RPC_URL
  },
  chainId: CHAIN_ID,   // e.g., 1 for Ethereum Mainnet
},
```

## Step 2: Run forked test

To run a specific forked test file, use the following command:

`npx hardhat test ./test/forked-test/file.ts`
