const { expect } = require("chai");
import { ethers } from "hardhat";
import { DataTypes } from "../typechain-types";
import { MockERC20, Escrow } from "../typechain-types";

export const setupTestContracts = async () => {
  const [owner, user1, user2] = await ethers.getSigners();
  const provider = owner.provider;

  // Deploy mock ERC20 tokens
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const settlementToken = await MockERC20.deploy("Settlement Token", "SETT", 6);
  const underlyingToken = await MockERC20.deploy("Underlying Token", "UND", 18);

  const MockERC20Votes = await ethers.getContractFactory("MockERC20Votes");
  const votingUnderlyingToken = await MockERC20Votes.deploy(
    "Voting Underlying Token",
    "Voting Underlying Token",
    18
  );

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
  await mockOracle.setPrice(
    votingUnderlyingToken.target,
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
    votingUnderlyingToken,
    escrowImpl,
    router,
    mockOracle,
  };
};

interface AuctionInitializationParams {
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
  borrowCap?: bigint;
  votingDelegationAllowed?: boolean;
  allowedDelegateRegistry?: string;
  premiumTokenIsUnderlying?: boolean;
  oracleAddress: string;
}

export const getAuctionInitialization = async ({
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
  borrowCap = 0n, // Default 0%
  votingDelegationAllowed = false, // Default false
  allowedDelegateRegistry = ethers.ZeroAddress, // Default 0x
  premiumTokenIsUnderlying = false, // Default false
  oracleAddress,
}: AuctionInitializationParams): Promise<DataTypes.AuctionInitialization> => {
  // Fetch the latest block to ensure we have the correct block timestamp
  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock) {
    throw new Error("Failed to retrieve the latest block.");
  }

  // Handle optional decayStartTime, defaulting to block timestamp + 100 seconds
  decayStartTime = decayStartTime || latestBlock.timestamp + 100;

  // Return the auction initialization struct with defaults and custom values
  return {
    underlyingToken: underlyingTokenAddress,
    settlementToken: settlementTokenAddress,
    notional: notionalAmount,
    auctionParams: {
      relStrike,
      tenor,
      earliestExerciseTenor,
      relPremiumStart,
      relPremiumFloor,
      decayDuration,
      minSpot,
      maxSpot,
      decayStartTime,
    },
    advancedSettings: {
      borrowCap,
      oracle: oracleAddress,
      premiumTokenIsUnderlying,
      votingDelegationAllowed,
      allowedDelegateRegistry,
    },
  };
};

export const createAuction = async (
  auctionInitialization: DataTypes.AuctionInitialization,
  router: any,
  owner: any
): Promise<Escrow> => {
  // Attach the underlying token to its contract instance
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const underlyingToken = (await MockERC20Factory.attach(
    auctionInitialization.underlyingToken
  )) as MockERC20;

  // Approve tokens and create the auction
  await underlyingToken
    .connect(owner)
    .approve(router.target, auctionInitialization.notional);

  // Create the auction via the Router contract
  await expect(
    router.connect(owner).createAuction(owner.address, auctionInitialization)
  ).to.emit(router, "CreateAuction");

  // Retrieve and return the created escrow instance
  const numEscrows = await router.numEscrows();
  const escrows = await router.getEscrows(numEscrows - 1n, 1);
  const escrowAddress = escrows[0];
  const EscrowImpl = await ethers.getContractFactory("Escrow");
  const escrow = EscrowImpl.attach(escrowAddress) as Escrow;

  return escrow;
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

export const rfqSignaturePayload = (
  rfqInitialization: DataTypes.RFQInitialization,
  chainId: number
): string => {
  const abiCoder = new ethers.AbiCoder();
  const payload = abiCoder.encode(
    [
      "uint256", // CHAIN_ID
      // OptionInfo
      "tuple(address,uint48,address,uint48,uint128,uint128,tuple(uint64,address,bool,bool,address))",
      // RFQQuote (only includes premium and validUntil)
      "uint256",
      "uint256",
    ],
    [
      chainId,
      [
        rfqInitialization.optionInfo.underlyingToken,
        rfqInitialization.optionInfo.expiry,
        rfqInitialization.optionInfo.settlementToken,
        rfqInitialization.optionInfo.earliestExercise,
        rfqInitialization.optionInfo.notional,
        rfqInitialization.optionInfo.strike,
        [
          rfqInitialization.optionInfo.advancedSettings.borrowCap,
          rfqInitialization.optionInfo.advancedSettings.oracle,
          rfqInitialization.optionInfo.advancedSettings
            .premiumTokenIsUnderlying,
          rfqInitialization.optionInfo.advancedSettings.votingDelegationAllowed,
          rfqInitialization.optionInfo.advancedSettings.allowedDelegateRegistry,
        ],
      ],
      rfqInitialization.rfqQuote.premium,
      rfqInitialization.rfqQuote.validUntil,
    ]
  );
  return ethers.keccak256(payload);
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
  borrowCap?: bigint;
  votingDelegationAllowed?: boolean;
  allowedDelegateRegistry?: string;
  premiumTokenIsUnderlying?: boolean;
  oracleAddress: string;
  router: any;
  owner: any;
}

export const swapSignaturePayload = (
  swapQuote: DataTypes.SwapQuote,
  chainId: number
): string => {
  const abiCoder = new ethers.AbiCoder();
  const payload = abiCoder.encode(
    [
      "uint256", // CHAIN_ID
      "address",
      "uint256",
      "address",
      "uint256",
      "uint256",
    ],
    [
      chainId,
      swapQuote.takerGiveToken,
      swapQuote.takerGiveAmount,
      swapQuote.makerGiveToken,
      swapQuote.makerGiveAmount,
      swapQuote.validUntil,
    ]
  );
  return ethers.keccak256(payload);
};

export const setupAuction = async (
  {
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
    borrowCap = 0n, // Default 0%
    votingDelegationAllowed = false, // Default false
    allowedDelegateRegistry = ethers.ZeroAddress, // Default 0x
    premiumTokenIsUnderlying = false, // Default false
    oracleAddress,
    router,
    owner,
  }: AuctionParams,
  setupFullAuction = true
) => {
  // Fetch the latest block to ensure we have the correct block timestamp
  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock) {
    throw new Error("Failed to retrieve the latest block.");
  }

  // Handle optional decayStartTime, defaulting to block timestamp + 100 seconds
  if (!decayStartTime) {
    decayStartTime = latestBlock.timestamp + 100;
  }

  if (setupFullAuction) {
    console.log(
      "Can use getAuctionInitialization() and createAuction() helper"
    );
  } else {
    console.log(
      "Can use getAuctionInitialization() and create auction separately to catch reverts"
    );
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
  const underlyingToken: any = await MockERC20Factory.attach(
    underlyingTokenAddress
  );
  let escrow: any;

  if (setupFullAuction) {
    // Approve tokens and start the auction
    await underlyingToken
      .connect(owner)
      .approve(router.target, auctionInitialization.notional);
    await expect(
      router.connect(owner).createAuction(owner.address, auctionInitialization)
    ).to.emit(router, "CreateAuction");

    // Attach the escrow instance
    const numEscrows = await router.numEscrows();
    const escrows = await router.getEscrows(numEscrows - 1n, 1);
    const escrowAddress = escrows[0];
    const escrowImpl = await ethers.getContractFactory("Escrow");
    escrow = await escrowImpl.attach(escrowAddress);
  }

  return { escrow, auctionInitialization };
};

interface RFQInitializationParams {
  underlyingTokenAddress: string;
  settlementTokenAddress: string;
  notionalAmount?: bigint;
  strike?: bigint;
  tenor?: number;
  premium?: bigint;
  validUntil?: number;
  borrowCap?: bigint;
  votingDelegationAllowed?: boolean;
  allowedDelegateRegistry?: string;
  premiumTokenIsUnderlying?: boolean;
  oracleAddress?: string;
}

export const getRFQInitialization = async ({
  underlyingTokenAddress,
  settlementTokenAddress,
  notionalAmount = ethers.parseEther("100"), // Default 100
  strike = ethers.parseEther("1"), // Default 1
  tenor = 86400 * 30, // Default 30 days
  premium = ethers.parseEther("10"), // Default 10
  validUntil, // Can be undefined, set below
  borrowCap = 0n, // Default 0%
  votingDelegationAllowed = true, // Default true
  allowedDelegateRegistry = ethers.ZeroAddress, // Default zero address
  premiumTokenIsUnderlying = false, // Default false
  oracleAddress = ethers.ZeroAddress,
}: RFQInitializationParams): Promise<DataTypes.RFQInitialization> => {
  // Fetch the latest block to ensure we have the correct block timestamp
  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock) {
    throw new Error("Failed to retrieve the latest block.");
  }

  // Handle optional validUntil, defaulting to block timestamp + 1 day
  validUntil = validUntil || latestBlock.timestamp + 86400;

  // Return the RFQ initialization struct with defaults and custom values
  const rfqInitialization: DataTypes.RFQInitialization = {
    optionInfo: {
      underlyingToken: underlyingTokenAddress,
      settlementToken: settlementTokenAddress,
      notional: notionalAmount,
      strike,
      earliestExercise: 0, // Default to 0 (no earliest exercise restriction)
      expiry: latestBlock.timestamp + tenor, // Set based on tenor
      advancedSettings: {
        borrowCap,
        oracle: oracleAddress,
        premiumTokenIsUnderlying,
        votingDelegationAllowed,
        allowedDelegateRegistry,
      },
    },
    rfqQuote: {
      premium,
      validUntil,
      signature: ethers.hexlify(ethers.randomBytes(65)), // Mock signature
    },
  };
  return rfqInitialization;
};

export const getLatestTimestamp = async () => {
  const latestBlock = await ethers.provider.getBlock("latest");
  return latestBlock ? latestBlock.timestamp : Date.now() / 1000;
};

export const getDefaultOptionInfo = async (
  underlyingToken: string,
  settlementToken: string,
  strike: BigInt,
  overrides: Partial<DataTypes.OptionInfo> = {}
): Promise<DataTypes.OptionInfo> => {
  const latestTimestamp = await getLatestTimestamp();

  const defaultOptionInfo: DataTypes.OptionInfo = {
    underlyingToken,
    settlementToken,
    notional: ethers.parseUnits("1", 18), // Default notional amount
    strike,
    earliestExercise: latestTimestamp, // Default now
    expiry: latestTimestamp + 60 * 60 * 24 * 30, // Default in 30 days
    advancedSettings: {
      borrowCap: 0,
      oracle: ethers.ZeroAddress,
      premiumTokenIsUnderlying: false,
      votingDelegationAllowed: false,
      allowedDelegateRegistry: ethers.ZeroAddress,
    },
  };

  return { ...defaultOptionInfo, ...overrides };
};
