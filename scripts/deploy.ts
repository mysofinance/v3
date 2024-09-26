import { ethers } from "hardhat";

async function getNetworkInfo(): Promise<[BigInt, string]> {
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

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);
  console.log("");

  const [CHAIN_ID, NETWORK_NAME] = await getNetworkInfo();
  console.log("Current chain ID:", CHAIN_ID);
  console.log("Current NETWORK_NAME:", NETWORK_NAME);
  console.log("");

  // Deploy MockERC20 for settlement token
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const settlementTokenName = "USDT";
  const settlementTokenSymbol = "USDT";
  const settlementTokenDecimals = 6;
  const settlementToken = await MockERC20.deploy(
    settlementTokenName,
    settlementTokenSymbol,
    settlementTokenDecimals
  );
  console.log(`* Settlement Token: ${settlementToken.target}`);

  // Deploy MockERC20 for underlying token
  const underlyingTokenName = "MYSO Token";
  const underlyingTokenSymbol = "MYT";
  const underlyingTokenDecimals = 18;
  const underlyingToken = await MockERC20.deploy(
    underlyingTokenName,
    underlyingTokenSymbol,
    underlyingTokenDecimals
  );
  console.log(`* Underlying Token: ${underlyingToken.target}`);

  // Deploy Escrow implementation
  const Escrow = await ethers.getContractFactory("Escrow");
  const escrowImpl = await Escrow.deploy();
  console.log(`* Escrow implementation: ${escrowImpl.target}`);

  // Deploy Router contract
  const Router = await ethers.getContractFactory("Router");
  const escrowImplAddr = "0xd900118C291874f1fB924F718f2F13D2a1F10E67"; // escrowImpl.target
  const router = await Router.deploy(
    deployer.address,
    escrowImplAddr,
    ethers.ZeroAddress
  );
  console.log(`* Router: ${router.target}`);

  // Deploy Mock Oracle
  const MockOracle = await ethers.getContractFactory("MockOracle");
  const mockOracle = await MockOracle.deploy();
  console.log(`* Mock Oracle: ${mockOracle.target}`);
  console.log("");

  // Set price in Mock Oracle
  const settlementTokenAddr = "0xE1bAA45977cA8DF95Dcf7c6480a9B36E89DF806A"; // settlementToken.target
  const underlyingTokenAddr = "0x935289Ad50B584eC9e9a6c34d2c4f6229520fF8D"; // underlyingToken.target
  await mockOracle.setPrice(
    underlyingTokenAddr,
    settlementTokenAddr,
    ethers.parseUnits("16.53", 6)
  );
  console.log(
    `Oracle price set for ${underlyingToken.target} against ${settlementToken.target}`
  );

  // Mint tokens for the deployer
  await settlementToken.mint(deployer.address, ethers.parseUnits("1000", 6));
  console.log(
    `Minted 1000 ${await settlementToken.symbol()} for ${deployer.address}`
  );

  const FeeHandler = await ethers.getContractFactory("FeeHandler");
  const initOwner = deployer.address;
  const routerAddr = router.target;
  const matchFee = ethers.parseEther("0.1");
  const distPartnerFeeShare = 0;
  const exerciseFee = 0;
  const feeHandler = await FeeHandler.deploy(
    initOwner,
    routerAddr,
    matchFee,
    distPartnerFeeShare,
    exerciseFee
  );
  console.log(`* Fee Handler: ${feeHandler.target}`);
  await router.connect(deployer).setFeeHandler(feeHandler.target);

  console.log("\nContract deployment complete.");
  console.log("Next, verify the contracts using the following commands:");
  console.log(
    `npx hardhat verify --network ${NETWORK_NAME} "${settlementTokenAddr}" "${settlementTokenName}" "${settlementTokenSymbol}" "${settlementTokenDecimals}"`
  );
  console.log(
    `npx hardhat verify --network ${NETWORK_NAME} "${underlyingTokenAddr}" "${underlyingTokenName}" "${underlyingTokenSymbol}" "${underlyingTokenDecimals}"`
  );
  console.log(
    `npx hardhat verify --network ${NETWORK_NAME} "${escrowImplAddr}"`
  );
  console.log(
    `npx hardhat verify --network ${NETWORK_NAME} "${router.target}" "${deployer.address}" "${escrowImplAddr}" "${ethers.ZeroAddress}"`
  );
  console.log(
    `npx hardhat verify --network ${NETWORK_NAME} "${mockOracle.target}"`
  );
  console.log(
    `npx hardhat verify --network ${NETWORK_NAME} "${feeHandler.target}" "${initOwner}" "${routerAddr}" "${matchFee}" "${distPartnerFeeShare}" "${exerciseFee}"`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
