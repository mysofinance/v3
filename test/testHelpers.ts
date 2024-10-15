const { expect } = require("chai");
import { ethers } from "hardhat";
import { DataTypes } from "../typechain-types";

export const setupTestContracts = async () => {
  const [owner, user1, user2] = await ethers.getSigners();
  const provider = owner.provider;

  // Deploy mock ERC20 tokens
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const settlementToken = await MockERC20.deploy("Settlement Token", "SETT", 6);
  const underlyingToken = await MockERC20.deploy("Underlying Token", "UND", 18);

  // Deploy Escrow implementation
  const Escrow = await ethers.getContractFactory("Escrow");
  const escrowImpl = await Escrow.deploy();

  // Deploy Router contract
  const Router = await ethers.getContractFactory("Router");
  const router = await Router.deploy(owner.address, escrowImpl.target);

  // Deploy mock oracle
  const MockOracle = await ethers.getContractFactory("MockOracle");
  const mockOracle = await MockOracle.deploy();
  await mockOracle.setPrice(
    underlyingToken.target,
    settlementToken.target,
    ethers.parseUnits("1", 6)
  );

  // Mint tokens for users
  await settlementToken.mint(owner.address, ethers.parseEther("1000"));
  await settlementToken.mint(user1.address, ethers.parseEther("1000"));
  await settlementToken.mint(user2.address, ethers.parseEther("1000"));

  await underlyingToken.mint(owner.address, ethers.parseEther("1000"));
  await underlyingToken.mint(user1.address, ethers.parseEther("1000"));
  await underlyingToken.mint(user2.address, ethers.parseEther("1000"));

  return {
    owner,
    user1,
    user2,
    provider,
    settlementToken,
    underlyingToken,
    escrowImpl,
    router,
    mockOracle,
  };
};

interface AuctionParams {
  underlyingTokenAddress: string;
  settlementTokenAddress: string;
  notionalAmount?: bigint;
  relStrike?: bigint;
  tenor?: number;
  earliestExerciseTenor?: number;
  relPremiumStart?: bigint;
  relPremiumFloor?: bigint;
  decayDuration?: number;
  minSpot?: bigint;
  maxSpot?: bigint;
  decayStartTime?: number;
  borrowCap?: number;
  votingDelegationAllowed?: boolean;
  allowedDelegateRegistry?: string;
  premiumTokenIsUnderlying?: boolean;
  oracleAddress: string;
  router: any;
  owner: any;
}

export const setupAuction = async ({
  underlyingTokenAddress,
  settlementTokenAddress,
  notionalAmount = ethers.parseEther("100"), // Default 100 ETH
  relStrike = ethers.parseEther("1.2"), // Default 120%
  tenor = 86400 * 30, // Default 30 days
  earliestExerciseTenor = 86400 * 7, // Default 7 days
  relPremiumStart = ethers.parseEther("0.1"), // Default 10%
  relPremiumFloor = ethers.parseEther("0.01"), // Default 1%
  decayDuration = 86400 * 7, // Default 7 days
  minSpot = BigInt(1), // Default 1
  maxSpot = BigInt(2) ** BigInt(128) - BigInt(1), // Default maxuint128
  decayStartTime, // Can be undefined, default set below
  borrowCap = 0, // Default 0%
  votingDelegationAllowed = false, // Default false
  allowedDelegateRegistry = ethers.ZeroAddress, // Default 0x
  premiumTokenIsUnderlying = false, // Default false
  oracleAddress,
  router,
  owner,
}: AuctionParams) => {
  // Fetch the latest block to ensure we have the correct block timestamp
  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock) {
    throw new Error("Failed to retrieve the latest block.");
  }

  // Handle optional decayStartTime, defaulting to block timestamp + 100 seconds
  if (!decayStartTime) {
    decayStartTime = latestBlock.timestamp + 100;
  }

  // Auction initialization parameters
  const auctionInitialization: DataTypes.AuctionInitialization = {
    underlyingToken: underlyingTokenAddress,
    settlementToken: settlementTokenAddress,
    notional: notionalAmount,
    auctionParams: {
      relStrike: relStrike,
      tenor: tenor,
      earliestExerciseTenor: earliestExerciseTenor,
      relPremiumStart: relPremiumStart,
      relPremiumFloor: relPremiumFloor,
      decayDuration: decayDuration,
      minSpot: minSpot,
      maxSpot: maxSpot,
      decayStartTime: decayStartTime,
    },
    advancedSettings: {
      borrowCap: borrowCap,
      votingDelegationAllowed: votingDelegationAllowed,
      allowedDelegateRegistry: allowedDelegateRegistry,
      premiumTokenIsUnderlying: premiumTokenIsUnderlying,
      oracle: oracleAddress,
    },
  };

  // Attach the underlying token and settlement token to their contract instances
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const underlyingToken = await MockERC20Factory.attach(underlyingTokenAddress);

  // Approve tokens and start the auction
  await underlyingToken
    .connect(owner)
    .approve(router.target, auctionInitialization.notional);
  await expect(
    router.connect(owner).createAuction(owner.address, auctionInitialization)
  ).to.emit(router, "CreateAuction");

  // Attach the escrow instance
  const escrows = await router.getEscrows(0, 1);
  const escrowAddress = escrows[0];
  const escrowImpl = await ethers.getContractFactory("Escrow");
  const escrow: any = await escrowImpl.attach(escrowAddress);

  return { escrow, auctionInitialization };
};

export const calculateExpectedAsk = (
  blockTimestamp: number,
  decayStartTime: number,
  decayDuration: number,
  relPremiumStart: bigint,
  relPremiumFloor: bigint
) => {
  let expectedAsk;
  if (blockTimestamp < decayStartTime) {
    expectedAsk = relPremiumStart; // Before decay starts
  } else if (blockTimestamp < decayStartTime + Number(decayDuration)) {
    const timePassed = BigInt(blockTimestamp) - BigInt(decayStartTime);
    expectedAsk =
      relPremiumStart -
      ((relPremiumStart - relPremiumFloor) * timePassed) /
        BigInt(decayDuration);
  } else {
    expectedAsk = relPremiumFloor; // After decay ends
  }
  return expectedAsk;
};
