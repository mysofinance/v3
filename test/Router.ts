const { expect } = require("chai");
import { ethers } from "hardhat";
import {
  Router,
  Escrow,
  MockERC20,
  MockOracle,
  DataTypes,
} from "../typechain-types";

describe("Router Contract", function () {
  let router: Router;
  let escrowImpl: Escrow;
  let settlementToken: MockERC20;
  let underlyingToken: MockERC20;
  let mockOracle: MockOracle;
  let owner: any;
  let user1: any;
  let user2: any;
  let provider: any;
  const CHAIN_ID = 31337;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    provider = owner.provider;

    // Deploy mock ERC20 token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    settlementToken = await MockERC20.deploy(
      "Settlement Token",
      "Settlement Token",
      6
    );
    underlyingToken = await MockERC20.deploy(
      "Underlying Token",
      "Underlying Token",
      18
    );

    // Deploy Escrow implementation
    const Escrow = await ethers.getContractFactory("Escrow");
    escrowImpl = await Escrow.deploy();

    // Deploy Router contract
    const Router = await ethers.getContractFactory("Router");
    router = await Router.deploy(
      owner.address,
      escrowImpl.target,
      ethers.ZeroAddress
    );

    // Deploy mock oracle
    const MockOracle = await ethers.getContractFactory("MockOracle");
    mockOracle = await MockOracle.deploy();
    await mockOracle.setPrice(
      underlyingToken.target,
      settlementToken.target,
      ethers.parseUnits("1", 6)
    );

    // Mint some tokens for the users
    await settlementToken.mint(owner.address, ethers.parseEther("1000"));
    await settlementToken.mint(user1.address, ethers.parseEther("1000"));
    await settlementToken.mint(user2.address, ethers.parseEther("1000"));

    await underlyingToken.mint(owner.address, ethers.parseEther("1000"));
    await underlyingToken.mint(user1.address, ethers.parseEther("1000"));
    await underlyingToken.mint(user2.address, ethers.parseEther("1000"));
  });

  describe("Start Auction", function () {
    it("should allow starting an auction", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: underlyingToken.target,
        settlementToken: settlementToken.target,
        notional: ethers.parseEther("100"),
        auctionParams: {
          relStrike: ethers.parseEther("1"),
          tenor: 86400 * 30, // 30 days
          earliestExerciseTenor: 86400 * 7, // 7 days
          relPremiumStart: ethers.parseEther("0.01"),
          relPremiumFloor: ethers.parseEther("0.005"),
          decayDuration: 86400 * 7, // 7 days
          minSpot: ethers.parseUnits("0.1", 6),
          maxSpot: ethers.parseUnits("1", 6),
          decayStartTime: (await provider.getBlock("latest")).timestamp + 100,
        },
        advancedEscrowSettings: {
          borrowingAllowed: true,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
        oracle: mockOracle.target,
      };

      // Approve and start auction
      await underlyingToken
        .connect(owner)
        .approve(router.target, auctionInitialization.notional);
      await expect(
        router.connect(owner).startAuction(owner.address, auctionInitialization)
      ).to.emit(router, "StartAuction");
    });
  });

  describe("Bid on Auction", function () {
    it("should allow bidding on an auction", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: underlyingToken.target,
        settlementToken: settlementToken.target,
        notional: ethers.parseEther("100"),
        auctionParams: {
          relStrike: ethers.parseEther("1"),
          tenor: 86400 * 30, // 30 days
          earliestExerciseTenor: 86400 * 7, // 7 days
          relPremiumStart: ethers.parseEther("0.01"),
          relPremiumFloor: ethers.parseEther("0.005"),
          decayDuration: 86400 * 7, // 7 days
          minSpot: ethers.parseUnits("0.1", 6),
          maxSpot: ethers.parseUnits("1", 6),
          decayStartTime: (await provider.getBlock("latest")).timestamp + 100,
        },
        advancedEscrowSettings: {
          borrowingAllowed: true,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
        oracle: mockOracle.target,
      };

      // Approve and start auction
      await underlyingToken
        .connect(owner)
        .approve(router.target, auctionInitialization.notional);
      await router
        .connect(owner)
        .startAuction(owner.address, auctionInitialization);

      const escrows = await router.getEscrows(0, 1);
      const escrowAddress = escrows[0];
      const escrow: any = await escrowImpl.attach(escrowAddress);

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = ethers.parseEther("0.02");
      const amount = ethers.parseEther("100");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any = [];
      const preview = await escrow.previewBid(
        relBid,
        refSpot,
        data,
        ethers.ZeroAddress
      );

      const optionReceiver = user1.address;
      await expect(
        router
          .connect(user1)
          .bidOnAuction(
            escrowAddress,
            optionReceiver,
            relBid,
            refSpot,
            data,
            ethers.ZeroAddress
          )
      )
        .to.emit(router, "BidOnAuction")
        .withArgs(escrowAddress, relBid, user1.address, refSpot, 0, 0);
    });
  });

  describe("Take Quote", function () {
    it("should allow taking a quote", async function () {
      let rfqInitialization: DataTypes.RFQInitialization = {
        optionInfo: {
          underlyingToken: underlyingToken.target,
          settlementToken: settlementToken.target,
          notional: ethers.parseEther("100"),
          strike: ethers.parseEther("1"),
          earliestExercise: 0,
          expiry: (await provider.getBlock("latest")).timestamp + 86400 * 30, // 30 days
          advancedEscrowSettings: {
            borrowingAllowed: true,
            votingDelegationAllowed: true,
            allowedDelegateRegistry: ethers.ZeroAddress,
          },
          oracle: ethers.ZeroAddress,
        },
        rfqQuote: {
          premium: ethers.parseEther("10"),
          validUntil: (await provider.getBlock("latest")).timestamp + 86400, // 1 day
          signature: ethers.hexlify(ethers.randomBytes(65)), // Mock signature
        },
      };

      const abiCoder = new ethers.AbiCoder();
      const payload = abiCoder.encode(
        [
          "uint256",
          "address",
          "address",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
        ],
        [
          CHAIN_ID,
          rfqInitialization.optionInfo.underlyingToken,
          rfqInitialization.optionInfo.settlementToken,
          rfqInitialization.optionInfo.notional,
          rfqInitialization.optionInfo.strike,
          rfqInitialization.optionInfo.expiry,
          rfqInitialization.optionInfo.earliestExercise,
          rfqInitialization.rfqQuote.premium,
          rfqInitialization.rfqQuote.validUntil,
        ]
      );
      const payloadHash = ethers.keccak256(payload);
      const signature = await owner.signMessage(ethers.getBytes(payloadHash));
      await settlementToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("1000000000000000"));
      rfqInitialization.rfqQuote.signature = signature;

      const preview = await router.previewTakeQuote(
        rfqInitialization,
        ethers.ZeroAddress
      );

      await underlyingToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      await expect(
        router
          .connect(user1)
          .takeQuote(user1.address, rfqInitialization, ethers.ZeroAddress)
      ).to.emit(router, "TakeQuote");
    });
  });
});
