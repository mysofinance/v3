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

    // Deploy fee handler
    const FeeHandler = await ethers.getContractFactory("FeeHandler");
    const initOwner = owner.address;
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
    await router.setFeeHandler(feeHandler.target);

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
        advancedSettings: {
          borrowCap: 0,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
          premiumTokenIsUnderlying: false,
          oracle: mockOracle.target,
        },
      };

      // Approve and start auction
      await underlyingToken
        .connect(owner)
        .approve(router.target, auctionInitialization.notional);
      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization)
      ).to.emit(router, "CreateAuction");
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
        advancedSettings: {
          borrowCap: 0,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
          premiumTokenIsUnderlying: false,
          oracle: mockOracle.target,
        },
      };

      // Approve and create auction
      await underlyingToken
        .connect(owner)
        .approve(router.target, auctionInitialization.notional);
      await router
        .connect(owner)
        .createAuction(owner.address, auctionInitialization);

      const escrows = await router.getEscrows(0, 1);
      const escrowAddress = escrows[0];
      const escrow: any = await escrowImpl.attach(escrowAddress);

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = ethers.parseEther("0.02");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any = [];
      const preview = await escrow.previewBid(
        relBid,
        refSpot,
        data,
        ethers.ZeroAddress
      );

      const optionReceiver = user1.address;
      const expectedProtocolMatchFee = preview[10];

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
        .withArgs(
          escrowAddress,
          relBid,
          user1.address,
          refSpot,
          expectedProtocolMatchFee,
          0
        );
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
          advancedSettings: {
            borrowCap: 0,
            votingDelegationAllowed: true,
            allowedDelegateRegistry: ethers.ZeroAddress,
            premiumTokenIsUnderlying: false,
            oracle: ethers.ZeroAddress,
          },
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
          "uint256", // CHAIN_ID
          // OptionInfo
          "tuple(address,address,uint256,uint256,uint256,uint256,tuple(uint256,address,bool,bool,address))",
          // RFQQuote (only includes premium and validUntil)
          "uint256",
          "uint256",
        ],
        [
          CHAIN_ID,
          [
            rfqInitialization.optionInfo.underlyingToken,
            rfqInitialization.optionInfo.settlementToken,
            rfqInitialization.optionInfo.notional,
            rfqInitialization.optionInfo.strike,
            rfqInitialization.optionInfo.expiry,
            rfqInitialization.optionInfo.earliestExercise,
            [
              rfqInitialization.optionInfo.advancedSettings.borrowCap,
              rfqInitialization.optionInfo.advancedSettings.oracle,
              rfqInitialization.optionInfo.advancedSettings
                .premiumTokenIsUnderlying,
              rfqInitialization.optionInfo.advancedSettings
                .votingDelegationAllowed,
              rfqInitialization.optionInfo.advancedSettings
                .allowedDelegateRegistry,
            ],
          ],
          rfqInitialization.rfqQuote.premium, // Include premium from rfqQuote
          rfqInitialization.rfqQuote.validUntil, // Include validUntil from rfqQuote
        ]
      );

      const payloadHash = ethers.keccak256(payload);
      const signature = await owner.signMessage(ethers.getBytes(payloadHash));
      await settlementToken
        .connect(owner)
        .approve(router.target, ethers.MaxUint256);
      rfqInitialization.rfqQuote.signature = signature;

      const preview = await router.previewTakeQuote(
        rfqInitialization,
        ethers.ZeroAddress
      );
      expect(preview.msgHash).to.be.equal(payloadHash);

      await underlyingToken
        .connect(user1)
        .approve(router.target, ethers.MaxUint256);
      await expect(
        router
          .connect(user1)
          .takeQuote(user1.address, rfqInitialization, ethers.ZeroAddress)
      ).to.emit(router, "TakeQuote");
    });
  });

  describe("Exercising Option Token", function () {
    it("should allow exercising option token", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: underlyingToken.target,
        settlementToken: settlementToken.target,
        notional: ethers.parseEther("100"),
        auctionParams: {
          relStrike: ethers.parseEther("1"),
          tenor: 86400 * 30, // 30 days
          earliestExerciseTenor: 0,
          relPremiumStart: ethers.parseEther("0.01"),
          relPremiumFloor: ethers.parseEther("0.005"),
          decayDuration: 86400 * 7, // 7 days
          minSpot: ethers.parseUnits("0.1", 6),
          maxSpot: ethers.parseUnits("1", 6),
          decayStartTime: (await provider.getBlock("latest")).timestamp + 100,
        },
        advancedSettings: {
          borrowCap: 0,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
          premiumTokenIsUnderlying: false,
          oracle: mockOracle.target,
        },
      };

      // Approve and create auction
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.MaxUint256);
      await router
        .connect(owner)
        .createAuction(owner.address, auctionInitialization);

      const escrows = await router.getEscrows(0, 1);
      const escrowAddress = escrows[0];
      const escrow: any = await escrowImpl.attach(escrowAddress);

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = ethers.parseEther("0.02");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any = [];
      const preview = await escrow.previewBid(
        relBid,
        refSpot,
        data,
        ethers.ZeroAddress
      );
      const expectedProtocolMatchFee = preview[10];

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
        .withArgs(
          escrowAddress,
          relBid,
          user1.address,
          refSpot,
          expectedProtocolMatchFee,
          0
        );

      const optionInfo = await escrow.optionInfo();
      const underlyingTokenDecimals = await underlyingToken.decimals();
      const notional = optionInfo[2];
      const strike = optionInfo[3];
      const expectedSettlementAmount =
        (BigInt(strike) * BigInt(notional)) /
        BigInt(10) ** underlyingTokenDecimals;

      await settlementToken.mint(user1.address, expectedSettlementAmount);
      const preSettlementTokenBal = await settlementToken.balanceOf(
        user1.address
      );
      const preUnderlyingTokenBal = await underlyingToken.balanceOf(
        user1.address
      );

      const underlyingReceiver = user1.address;
      const underlyingAmount = auctionInitialization.notional;
      const payInSettlementToken = true;
      const oracleData: any = [];
      await router
        .connect(user1)
        .exercise(
          escrowAddress,
          underlyingReceiver,
          underlyingAmount,
          payInSettlementToken,
          oracleData
        );

      const postSettlementTokenBal = await settlementToken.balanceOf(
        user1.address
      );
      const postUnderlyingTokenBal = await underlyingToken.balanceOf(
        user1.address
      );

      expect(preSettlementTokenBal - postSettlementTokenBal).to.be.equal(
        expectedSettlementAmount
      );
      expect(postUnderlyingTokenBal - preUnderlyingTokenBal).to.be.equal(
        notional
      );
    });
  });
});
