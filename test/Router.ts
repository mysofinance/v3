const { expect } = require("chai");
import { ethers } from "hardhat";
import { Router, Escrow, MockERC20, MockOracle } from "../typechain-types";
import {
  setupTestContracts,
  getAuctionInitialization,
  createAuction,
  calculateExpectedAsk,
  getRFQInitialization,
  rfqSignaturePayload,
  swapSignaturePayload,
  getLatestTimestamp,
  getDefaultOptionInfo,
} from "./testHelpers";
import { DataTypes } from "./DataTypes";

const BASE = ethers.parseEther("1");

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
    const contracts = await setupTestContracts();
    ({
      owner,
      user1,
      user2,
      provider,
      settlementToken,
      underlyingToken,
      escrowImpl,
      router,
      mockOracle,
    } = contracts);
  });

  describe("Start Auction", function () {
    it("should allow starting an auction", async function () {
      // Use the createAuction helper method
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      const escrow = await createAuction(auctionInitialization, router, owner);

      expect(escrow).to.exist; // Ensure the escrow was created
    });

    it("should calculate current ask correctly across different premium values", async function () {
      const relPremiumStart = ethers.parseEther("0.01");
      const relPremiumFloor = ethers.parseEther("0.005");

      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relPremiumStart,
        relPremiumFloor,
        oracleAddress: String(mockOracle.target),
      });
      const escrow = await createAuction(auctionInitialization, router, owner);

      // Check current ask before decay starts
      await ethers.provider.send("evm_increaseTime", [50]);
      await ethers.provider.send("evm_mine", []);

      let currentAsk = await escrow.currAsk();
      let block = await ethers.provider.getBlock("latest");
      let blockTimestamp = block?.timestamp || new Date().getTime() / 1000;

      // Calculate expected ask
      let expectedAsk = calculateExpectedAsk(
        blockTimestamp,
        auctionInitialization.auctionParams.decayStartTime,
        auctionInitialization.auctionParams.decayDuration,
        BigInt(relPremiumStart.toString()),
        BigInt(relPremiumFloor.toString())
      );

      expect(currentAsk).to.equal(expectedAsk);

      // Check current ask during decay period
      await ethers.provider.send("evm_increaseTime", [3 * 86400]);
      await ethers.provider.send("evm_mine", []);

      currentAsk = await escrow.currAsk();
      block = await ethers.provider.getBlock("latest");
      blockTimestamp = block?.timestamp || new Date().getTime() / 1000;

      expectedAsk = calculateExpectedAsk(
        blockTimestamp,
        auctionInitialization.auctionParams.decayStartTime,
        auctionInitialization.auctionParams.decayDuration,
        BigInt(relPremiumStart.toString()),
        BigInt(relPremiumFloor.toString())
      );

      expect(currentAsk).to.equal(expectedAsk);

      // Check current ask after decay finishes
      await ethers.provider.send("evm_increaseTime", [5 * 86400]);
      await ethers.provider.send("evm_mine", []);

      currentAsk = await escrow.currAsk();
      expectedAsk = relPremiumFloor;
      expect(currentAsk).to.equal(expectedAsk);
    });
  });

  describe("Bid on Auction", function () {
    it("should allow bidding on an auction", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      const escrow = await createAuction(auctionInitialization, router, owner);

      // Approve and bid on auction
      let currentAsk = await escrow.currAsk();
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = currentAsk;
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
            escrow.target,
            optionReceiver,
            relBid,
            refSpot,
            data,
            ethers.ZeroAddress
          )
      )
        .to.emit(router, "BidOnAuction")
        .withArgs(
          user1.address,
          escrow.target,
          relBid,
          user1.address,
          refSpot,
          expectedProtocolMatchFee,
          0,
          ethers.ZeroAddress
        );
    });
  });

  describe("Take Quote", function () {
    it("should allow taking a quote", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
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
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      const escrow = await createAuction(auctionInitialization, router, owner);

      // Approve and bid on auction
      let currentAsk = await escrow.currAsk();
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = currentAsk;
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
            escrow.target,
            optionReceiver,
            relBid,
            refSpot,
            data,
            ethers.ZeroAddress
          )
      ).to.emit(router, "BidOnAuction");

      const optionInfo = await escrow.optionInfo();
      const underlyingTokenDecimals = await underlyingToken.decimals();
      const notional = optionInfo[4];
      const strike = optionInfo[5];
      const expectedSettlementAmount =
        (BigInt(strike) * BigInt(notional)) /
        BigInt(10) ** underlyingTokenDecimals;

      // Move forward after earliest exercise
      const earliestExercise = optionInfo[3];
      const block = await ethers.provider.getBlock("latest");
      const blockTimestamp = block?.timestamp || new Date().getTime() / 1000;
      const moveForwardTime = Number(earliestExercise) - blockTimestamp + 1;

      await ethers.provider.send("evm_increaseTime", [moveForwardTime]);
      await ethers.provider.send("evm_mine", []);

      await settlementToken.mint(user1.address, expectedSettlementAmount);
      const preSettlementTokenBal = await settlementToken.balanceOf(
        user1.address
      );
      const preUnderlyingTokenBal = await underlyingToken.balanceOf(
        user1.address
      );
      const preOptionTokenBalance = await escrow.balanceOf(user1.address);
      const preOptionTokenSupply = await escrow.totalSupply();

      const underlyingReceiver = user1.address;
      const underlyingAmount = auctionInitialization.notional;
      const payInSettlementToken = true;
      const oracleData: any = [];
      await router
        .connect(user1)
        .exercise(
          escrow.target,
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
      const postOptionTokenBalance = await escrow.balanceOf(user1.address);
      const postOptionTokenSupply = await escrow.totalSupply();

      expect(preSettlementTokenBal - postSettlementTokenBal).to.be.equal(
        expectedSettlementAmount
      );
      expect(postUnderlyingTokenBal - preUnderlyingTokenBal).to.be.equal(
        notional
      );
      expect(preOptionTokenBalance - postOptionTokenBalance).to.be.equal(
        postUnderlyingTokenBal - preUnderlyingTokenBal
      );
      expect(preOptionTokenBalance - postOptionTokenBalance).to.be.equal(
        preOptionTokenSupply - postOptionTokenSupply
      );
    });
  });

  describe("Swap Option Token", function () {
    let auctionInitialization: DataTypes.AuctionInitialization;
    let escrow: any;
    let swapQuote: DataTypes.SwapQuote;
    let maker: any;
    let optionReceiver: string;
    let optionTokenAddr: string;
    let optionTokenAmount: bigint;
    let payAmount: bigint;

    beforeEach(async function () {
      // Initialize auction and escrow
      auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });

      escrow = await createAuction(auctionInitialization, router, owner);

      // Approve and bid on auction
      let currentAsk = await escrow.currAsk();
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));

      const relBid = currentAsk;
      const refSpot = ethers.parseUnits("1", 6);
      const data: any = [];

      optionReceiver = user1.address;
      await expect(
        router
          .connect(user1)
          .bidOnAuction(
            escrow.target,
            optionReceiver,
            relBid,
            refSpot,
            data,
            ethers.ZeroAddress
          )
      ).to.emit(router, "BidOnAuction");

      const preBal = await settlementToken.balanceOf(user1.address);
      const postBal = await settlementToken.balanceOf(user1.address);

      maker = user1;
      optionTokenAddr = String(escrow.target);
      optionTokenAmount = await escrow.totalSupply();
      payAmount = ((preBal - postBal) * BigInt(1100)) / BigInt(1000);

      // Expect allowance to be automatically set to max. on mint to
      // minimize overhead for follow-on option token swapping via router
      expect(await escrow.allowance(user1.address, router.target)).to.be.equal(
        ethers.MaxUint256
      );

      swapQuote = {
        takerGiveToken: String(settlementToken.target),
        takerGiveAmount: payAmount,
        makerGiveToken: optionTokenAddr,
        makerGiveAmount: optionTokenAmount,
        validUntil: (await getLatestTimestamp()) + 60 * 5, // 5 minutes from now
        signature: "",
        eip1271Maker: ethers.ZeroAddress,
      };

      const payloadHash = swapSignaturePayload(swapQuote, CHAIN_ID);
      const signature = await maker.signMessage(ethers.getBytes(payloadHash));
      swapQuote.signature = signature;
    });

    it("should revert when attempting to take an expired quote", async function () {
      // Set expired timestamp
      swapQuote.validUntil = 0;

      const expiredPayloadHash = swapSignaturePayload(swapQuote, CHAIN_ID);
      const expiredSignature = await maker.signMessage(
        ethers.getBytes(expiredPayloadHash)
      );
      swapQuote.signature = expiredSignature;

      await expect(
        router.connect(user2).takeSwapQuote(user2.address, swapQuote)
      ).to.be.revertedWithCustomError(router, "SwapQuoteExpired");
    });

    it("should revert when attempting to take a quote while the contract is paused", async function () {
      // Pausing quotes
      await router.connect(maker).togglePauseQuotes();

      await expect(
        router.connect(user2).takeSwapQuote(user2.address, swapQuote)
      ).to.be.revertedWithCustomError(router, "SwapQuotePaused");

      // Unpause for other tests
      await router.connect(maker).togglePauseQuotes();
    });

    it("should allow a successful swap of the option token", async function () {
      const taker = user2;

      const preSettlementTokenBalMaker = await settlementToken.balanceOf(
        maker.address
      );
      const preOptionTokenBalMaker = await escrow.balanceOf(maker.address);
      const preSettlementTokenBalTaker = await settlementToken.balanceOf(
        taker.address
      );
      const preOptionTokenBalTaker = await escrow.balanceOf(taker.address);

      await settlementToken
        .connect(taker)
        .approve(router.target, ethers.MaxUint256);

      await expect(
        router.connect(taker).takeSwapQuote(taker.address, swapQuote)
      ).to.emit(router, "TakeSwapQuote");

      const postSettlementTokenBalMaker = await settlementToken.balanceOf(
        maker.address
      );
      const postOptionTokenBalMaker = await escrow.balanceOf(maker.address);
      const postSettlementTokenBalTaker = await settlementToken.balanceOf(
        taker.address
      );
      const postOptionTokenBalTaker = await escrow.balanceOf(taker.address);

      // Check balances after the swap
      expect(
        postSettlementTokenBalMaker - preSettlementTokenBalMaker
      ).to.be.equal(swapQuote.takerGiveAmount);
      expect(
        preSettlementTokenBalTaker - postSettlementTokenBalTaker
      ).to.be.equal(swapQuote.takerGiveAmount);
      expect(preOptionTokenBalMaker - postOptionTokenBalMaker).to.be.equal(
        swapQuote.makerGiveAmount
      );
      expect(postOptionTokenBalTaker - preOptionTokenBalTaker).to.be.equal(
        swapQuote.makerGiveAmount
      );
    });

    it("should revert when attempting to take the same quote twice", async function () {
      const taker = user2;

      await settlementToken
        .connect(taker)
        .approve(router.target, ethers.MaxUint256);

      // First successful take
      await expect(
        router.connect(taker).takeSwapQuote(taker.address, swapQuote)
      ).to.emit(router, "TakeSwapQuote");

      // Attempt to take the same quote again
      await expect(
        router.connect(taker).takeSwapQuote(taker.address, swapQuote)
      ).to.be.revertedWithCustomError(router, "SwapQuoteAlreadyUsed");
    });
  });

  describe("Option Token Minting", function () {
    let optionInfo: DataTypes.OptionInfo;
    let optionReceiver: string;
    let escrowOwner: string;

    beforeEach(async function () {
      // Initialize the necessary variables
      optionInfo = await getDefaultOptionInfo(
        String(underlyingToken.target),
        String(settlementToken.target),
        ethers.parseUnits("1", await settlementToken.decimals())
      );
      optionReceiver = user1.address;
      escrowOwner = user1.address;
    });

    it("should revert when the underlying token is the same as the settlement token", async function () {
      // Set underlyingToken and settlementToken to be the same
      optionInfo.underlyingToken = optionInfo.settlementToken;

      await expect(
        router
          .connect(user1)
          .mintOption(optionReceiver, escrowOwner, optionInfo)
      ).to.be.revertedWithCustomError(router, "InvalidTokenPair");
    });

    it("should revert when the notional is zero", async function () {
      // Set notional to 0
      optionInfo.notional = 0n;

      await expect(
        router
          .connect(user1)
          .mintOption(optionReceiver, escrowOwner, optionInfo)
      ).to.be.revertedWithCustomError(router, "InvalidNotional");
    });

    it("should revert when the expiry is in the past", async function () {
      // Set expiry to a timestamp in the past
      optionInfo.expiry = (await getLatestTimestamp()) - 100;

      await expect(
        router
          .connect(user1)
          .mintOption(optionReceiver, escrowOwner, optionInfo)
      ).to.be.revertedWithCustomError(router, "InvalidExpiry");
    });

    it("should revert when the earliest exercise is not at least 1 day before expiry", async function () {
      // Set expiry to less than 1 day after earliestExercise
      optionInfo.expiry = optionInfo.earliestExercise + 60 * 60 * 12; // 12 hours later

      await expect(
        router
          .connect(user1)
          .mintOption(optionReceiver, escrowOwner, optionInfo)
      ).to.be.revertedWithCustomError(router, "InvalidEarliestExercise");
    });

    it("should revert when the borrow cap exceeds the base", async function () {
      // Set borrowCap greater than BASE
      optionInfo.advancedSettings.borrowCap = BASE + 1n;

      await expect(
        router
          .connect(user1)
          .mintOption(optionReceiver, escrowOwner, optionInfo)
      ).to.be.revertedWithCustomError(router, "InvalidBorrowCap");
    });

    it("should allow minting of option token with valid parameters", async function () {
      // Adjust optionInfo to valid parameters
      optionInfo.underlyingToken = String(underlyingToken.target);
      optionInfo.settlementToken = String(settlementToken.target);
      optionInfo.notional = ethers.parseUnits("1000", 18); // Set a valid notional
      optionInfo.expiry = (await getLatestTimestamp()) + 60 * 60 * 24 * 7; // 7 days from now
      optionInfo.earliestExercise =
        (await getLatestTimestamp()) + 60 * 60 * 24 * 2; // 2 days from now
      optionInfo.advancedSettings.borrowCap = BASE; // Set borrowCap to a valid value

      // Assume user1 will transfer underlying tokens for the option
      await underlyingToken
        .connect(user1)
        .approve(router.target, optionInfo.notional);

      // Mint the option
      const preUnderlyingUserBal = await underlyingToken.balanceOf(
        user1.address
      );
      await expect(
        router
          .connect(user1)
          .mintOption(optionReceiver, escrowOwner, optionInfo)
      ).to.emit(router, "MintOption");
      const postUnderlyingUserBal = await underlyingToken.balanceOf(
        user1.address
      );

      // Check if the escrow is created and initialized correctly
      const escrowAddrs = await router.getEscrows(0, 1);
      const EscrowImpl = await ethers.getContractFactory("Escrow");
      const escrow = EscrowImpl.attach(escrowAddrs[0]) as Escrow;
      const escrowOptionInfo = await escrow.optionInfo();
      expect(escrowOptionInfo.underlyingToken).to.be.equal(
        optionInfo.underlyingToken
      );
      expect(escrowOptionInfo.settlementToken).to.be.equal(
        optionInfo.settlementToken
      );
      expect(escrowOptionInfo.notional).to.be.equal(optionInfo.notional);
      expect(escrowOptionInfo.expiry).to.be.equal(optionInfo.expiry);
      expect(escrowOptionInfo.earliestExercise).to.be.equal(
        optionInfo.earliestExercise
      );

      // Ensure the underlying token has been transferred to the escrow
      const escrowBalance = await underlyingToken.balanceOf(escrow.target);
      expect(escrowBalance).to.be.equal(optionInfo.notional);
      expect(preUnderlyingUserBal - postUnderlyingUserBal).to.be.equal(
        optionInfo.notional
      );

      // Ensure option cannot be re-initialized
      await expect(
        escrow.initializeMintOption(
          router.target,
          owner.address,
          owner.address,
          0,
          optionInfo,
          0
        )
      ).to.be.reverted;
    });
  });
});
