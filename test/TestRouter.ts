const { expect } = require("chai");
import { ethers } from "hardhat";
import {
  Router,
  Escrow,
  MockERC20,
  MockOracle,
  FeeHandler,
} from "../typechain-types";
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
} from "./helpers";
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

  describe("Deployment", function () {
    it("should revert if escrow implementation is zero address", async function () {
      // Check revert if trying to deploy with escrow implementation contract being zero address
      const Router = await ethers.getContractFactory("Router");
      await expect(
        Router.deploy(owner.address, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(Router, "InvalidAddress");
    });
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

      const name = await escrow.name();
      const symbol = await escrow.symbol();
      const decimals = await escrow.decimals();

      const numEscrows = await router.numEscrows();
      const expectedName = `${await underlyingToken.name()} O${numEscrows}`;
      const expectedSymbol = `${await underlyingToken.symbol()} O${numEscrows}`;
      const expectedDecimals = await underlyingToken.decimals();

      expect(name).to.be.equal(expectedName);
      expect(symbol).to.be.equal(expectedSymbol);
      expect(decimals).to.be.equal(expectedDecimals);
    });

    it("should set distribution partner at auction creation", async function () {
      // Use the createAuction helper method
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });

      const escrow1 = await createAuction(
        auctionInitialization,
        router,
        owner,
        ethers.ZeroAddress
      );
      expect(await escrow1.distPartner()).to.be.equal(ethers.ZeroAddress);
      let currentAsk = await escrow1.currAsk();
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      let relBid = currentAsk;
      let refSpot = ethers.parseUnits("1", 6);
      let data: any = [];
      const previewBid1 = await escrow1.previewBid(relBid, refSpot, data);
      expect(previewBid1[1]).to.be.equal(ethers.ZeroAddress);

      const escrow2 = await createAuction(
        auctionInitialization,
        router,
        owner,
        user1.address
      );
      expect(await escrow2.distPartner()).to.be.equal(user1.address);
      currentAsk = await escrow1.currAsk();
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      relBid = currentAsk;
      const previewBid2 = await escrow2.previewBid(relBid, refSpot, data);
      expect(previewBid2[1]).to.be.equal(user1.address);
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
      const { preview } = await escrow.previewBid(relBid, refSpot, data);

      const optionReceiver = user1.address;
      const expectedProtocolMatchFee = preview[10];

      await expect(
        router
          .connect(user1)
          .bidOnAuction(escrow.target, optionReceiver, relBid, refSpot, data)
      ).to.emit(router, "BidOnAuction");
    });

    it("should revert when trying to bid on an empty escrow", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      auctionInitialization.auctionParams.earliestExerciseTenor = 0;

      const ownerBalPreEscrowCreation = await underlyingToken.balanceOf(
        owner.address
      );
      const escrow = await createAuction(auctionInitialization, router, owner);
      const ownerBalPostEscrowCreation = await underlyingToken.balanceOf(
        owner.address
      );
      const escrowBalPostEscrowCreation = await underlyingToken.balanceOf(
        escrow.target
      );
      expect(
        ownerBalPreEscrowCreation - ownerBalPostEscrowCreation
      ).to.be.equal(auctionInitialization.notional);
      expect(escrowBalPostEscrowCreation).to.be.equal(
        auctionInitialization.notional
      );

      // Escrow owner removes tokens
      await router
        .connect(owner)
        .withdraw(
          escrow.target,
          owner.address,
          underlyingToken.target,
          escrowBalPostEscrowCreation
        );
      const ownerBalPostWithdraw = await underlyingToken.balanceOf(
        owner.address
      );
      const vaultBalPostWithdraw = await underlyingToken.balanceOf(
        escrow.target
      );
      expect(ownerBalPostWithdraw - ownerBalPostEscrowCreation).to.be.equal(
        auctionInitialization.notional
      );
      expect(vaultBalPostWithdraw).to.be.equal(0n);

      // Approve and bid on auction
      let currentAsk = await escrow.currAsk();
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = currentAsk;
      const refSpot = ethers.parseUnits("1", 6);
      const data: any = [];

      const optionReceiver = user1.address;

      await expect(
        router
          .connect(user1)
          .bidOnAuction(escrow.target, optionReceiver, relBid, refSpot, data)
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidBid");
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

  describe("Put Writing", function () {
    it("should allow put writing", async function () {
      const tradingFirm = user1;
      const client = user2;

      const weth = underlyingToken;
      const usdc = settlementToken;

      const ethPriceInUsdc = ethers.parseUnits("2500", 6);
      const strikePriceInUsdc = ethers.parseUnits("2000", 6);

      const notionalAmountInUsdc = ethers.parseUnits("100000", 6);
      const strikePriceInEth =
        (ethers.parseEther("1") * strikePriceInUsdc) / ethPriceInUsdc;
      const tenor = 30 * 24 * 60 * 60;
      const premiumTokenIsUnderlying = true;
      const putPremium = ethers.parseUnits("1010", 6);

      const putWritingRfqInit = await getRFQInitialization({
        underlyingTokenAddress: String(usdc.target),
        settlementTokenAddress: String(weth.target),
        notionalAmount: notionalAmountInUsdc,
        strike: strikePriceInEth,
        tenor: tenor,
        premiumTokenIsUnderlying: premiumTokenIsUnderlying,
        premium: putPremium,
        earliestExerciseTenor: 0,
      });

      // Trading firm prepares signature
      const payloadHash = rfqSignaturePayload(putWritingRfqInit, CHAIN_ID);
      const signature = await tradingFirm.signMessage(
        ethers.getBytes(payloadHash)
      );
      putWritingRfqInit.rfqQuote.signature = signature;

      // Trading firm approves USDC to pay for premium
      await usdc.mint(tradingFirm, putPremium);
      await usdc.connect(tradingFirm).approve(router.target, ethers.MaxUint256);

      // Client approves USDC to provide collateral for WETH put
      await usdc.mint(client, notionalAmountInUsdc);
      await usdc.connect(client).approve(router.target, ethers.MaxUint256);

      // Client takes quote
      const preBalUsdcClient = await usdc.balanceOf(client);
      const preBalUsdcTradingFirm = await usdc.balanceOf(tradingFirm);
      const preBalWethClient = await weth.balanceOf(client);
      const preBalWethTradingFirm = await weth.balanceOf(tradingFirm);
      await expect(
        router
          .connect(client)
          .takeQuote(client, putWritingRfqInit, ethers.ZeroAddress)
      ).to.emit(router, "TakeQuote");
      const postBalUsdcClient = await usdc.balanceOf(client);
      const postBalUsdcTradingFirm = await usdc.balanceOf(tradingFirm);
      const postBalWethClient = await weth.balanceOf(client);
      const postBalWethTradingFirm = await weth.balanceOf(tradingFirm);

      // Check balance changes
      // Client provides cash collateral for put and receives premium
      expect(preBalUsdcClient - postBalUsdcClient).to.be.equal(
        notionalAmountInUsdc - putPremium
      );
      // Trading firms pays premium
      expect(preBalUsdcTradingFirm - postBalUsdcTradingFirm).to.be.equal(
        putPremium
      );
      expect(preBalWethClient - postBalWethClient).to.be.equal(0);
      expect(postBalWethTradingFirm).to.be.equal(preBalWethTradingFirm);

      // Get escrow contract
      const numEscrows = await router.numEscrows();
      const escrowAddrs = await router.getEscrows(numEscrows - 1n, 1);
      const postBalWethEscrow = await usdc.balanceOf(escrowAddrs[0]);
      expect(postBalWethEscrow).to.be.equal(notionalAmountInUsdc);

      // Trading firm exercises put and sells WETH to get USDC
      const wethPayAmount =
        (strikePriceInEth * notionalAmountInUsdc) / ethers.parseUnits("1", 6);
      await weth.mint(tradingFirm, wethPayAmount);
      const preBal2UsdcClient = await usdc.balanceOf(client);
      const preBal2UsdcTradingFirm = await usdc.balanceOf(tradingFirm);
      const preBal2WethClient = await weth.balanceOf(client);
      const preBal2WethTradingFirm = await weth.balanceOf(tradingFirm);
      const payInSettlementToken = true; // pay in WETH
      const oracleData: any = [];
      await weth.connect(tradingFirm).approve(router.target, ethers.MaxUint256);
      await router
        .connect(tradingFirm)
        .exercise(
          escrowAddrs[0],
          tradingFirm,
          notionalAmountInUsdc,
          payInSettlementToken,
          oracleData
        );
      const postBal2UsdcClient = await usdc.balanceOf(client);
      const postBal2UsdcTradingFirm = await usdc.balanceOf(tradingFirm);
      const postBal2WethClient = await weth.balanceOf(client);
      const postBal2WethTradingFirm = await weth.balanceOf(tradingFirm);

      // Check balance changes
      // Trading firm gets cash collateral from selling WETH
      expect(postBal2UsdcTradingFirm - preBal2UsdcTradingFirm).to.be.equal(
        notionalAmountInUsdc
      );
      expect(preBal2WethTradingFirm - postBal2WethTradingFirm).to.be.equal(
        wethPayAmount
      );
      expect(postBal2UsdcClient).to.be.equal(preBal2UsdcClient);
      expect(postBal2WethClient - preBal2WethClient).to.be.equal(wethPayAmount);

      const postBal2WethEscrow = await usdc.balanceOf(escrowAddrs[0]);
      expect(postBal2WethEscrow).to.be.equal(0);
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
      const { preview } = await escrow.previewBid(relBid, refSpot, data);
      const expectedProtocolMatchFee = preview[10];

      const optionReceiver = user1.address;
      await expect(
        router
          .connect(user1)
          .bidOnAuction(escrow.target, optionReceiver, relBid, refSpot, data)
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
          .bidOnAuction(escrow.target, optionReceiver, relBid, refSpot, data)
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
    let feeHandler: FeeHandler;

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
        router.connect(user1).mintOption(
          optionReceiver,
          escrowOwner,
          optionInfo,
          {
            name: "Option Name",
            symbol: "Option Symbol",
          } as DataTypes.OptionNaming,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(router, "InvalidTokenPair");
    });

    it("should revert when the notional is zero", async function () {
      // Set notional to 0
      optionInfo.notional = 0n;

      await expect(
        router.connect(user1).mintOption(
          optionReceiver,
          escrowOwner,
          optionInfo,
          {
            name: "Option Name",
            symbol: "Option Symbol",
          } as DataTypes.OptionNaming,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(router, "InvalidNotional");
    });

    it("should revert when the expiry is in the past", async function () {
      // Set expiry to a timestamp in the past
      optionInfo.expiry = (await getLatestTimestamp()) - 100;

      await expect(
        router.connect(user1).mintOption(
          optionReceiver,
          escrowOwner,
          optionInfo,
          {
            name: "Option Name",
            symbol: "Option Symbol",
          } as DataTypes.OptionNaming,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(router, "InvalidExpiry");
    });

    it("should revert when the earliest exercise is not at least 1 day before expiry", async function () {
      // Set expiry to less than 1 day after earliestExercise
      optionInfo.expiry = optionInfo.earliestExercise + 60 * 60 * 12; // 12 hours later

      await expect(
        router.connect(user1).mintOption(
          optionReceiver,
          escrowOwner,
          optionInfo,
          {
            name: "Option Name",
            symbol: "Option Symbol",
          } as DataTypes.OptionNaming,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(router, "InvalidEarliestExercise");
    });

    it("should revert when the borrow cap exceeds the base", async function () {
      // Set borrowCap greater than BASE
      optionInfo.advancedSettings.borrowCap = BASE + 1n;

      await expect(
        router.connect(user1).mintOption(
          optionReceiver,
          escrowOwner,
          optionInfo,
          {
            name: "Option Name",
            symbol: "Option Symbol",
          } as DataTypes.OptionNaming,
          ethers.ZeroAddress
        )
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
        router.connect(user1).mintOption(
          optionReceiver,
          escrowOwner,
          optionInfo,
          {
            name: "Option Name",
            symbol: "Option Symbol",
          } as DataTypes.OptionNaming,
          ethers.ZeroAddress
        )
      ).to.emit(router, "MintOption");

      const postUnderlyingUserBal = await underlyingToken.balanceOf(
        user1.address
      );

      // Check if the escrow is created and initialized correctly
      const escrowAddrs = await router.getEscrows(0, 1);
      const EscrowImpl = await ethers.getContractFactory("Escrow");
      const escrow = EscrowImpl.attach(escrowAddrs[0]) as Escrow;

      // Check option token name, symbol and decimals
      expect(await escrow.name()).to.be.equal("Option Name");
      expect(await escrow.symbol()).to.be.equal("Option Symbol");
      expect(await escrow.decimals()).to.be.equal(
        await underlyingToken.decimals()
      );

      // Check option is minted, linked router, owner and exercise fee
      expect(await escrow.optionMinted()).to.be.true;
      expect(await escrow.router()).to.be.equal(router.target);
      expect(await escrow.owner()).to.be.equal(escrowOwner);
      expect(await escrow.exerciseFee()).to.be.equal(
        await router.getExerciseFee()
      );

      // Check option info
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
          {
            name: "Option Name",
            symbol: "Option Symbol",
          } as DataTypes.OptionNaming
        )
      ).to.be.reverted;

      // Check revert when trying to retrieve distribution partner on non-auction
      await expect(escrow.distPartner()).to.be.revertedWithCustomError(
        escrow,
        "OnlyAvailableForAuctions"
      );
    });

    describe("Option Token Minting with Fees", function () {
      beforeEach(async function () {
        const FeeHandler = await ethers.getContractFactory("FeeHandler");
        feeHandler = await FeeHandler.deploy(owner.address, 0n, 0n, 0n);
        await router.connect(owner).setFeeHandler(feeHandler.target);
      });

      it("should correctly apply protocol mint fee", async function () {
        const mintFee = ethers.parseUnits("0.01", 18); // 1% mint fee
        await feeHandler.setMintFee(mintFee);

        await underlyingToken
          .connect(user1)
          .approve(router.target, optionInfo.notional);
        const expectedFee = (optionInfo.notional * mintFee) / BASE;

        await expect(
          router.connect(user1).mintOption(
            optionReceiver,
            escrowOwner,
            optionInfo,
            {
              name: "Option Name",
              symbol: "Option Symbol",
            } as DataTypes.OptionNaming,
            ethers.ZeroAddress
          )
        ).to.emit(router, "MintOption");

        const numEscrows = await router.numEscrows();
        const optionTokenAddress = await router.getEscrows(numEscrows - 1n, 1);
        const EscrowImpl = await ethers.getContractFactory("Escrow");
        const optionToken = EscrowImpl.attach(optionTokenAddress[0]) as Escrow;

        const feeHandlerBalance = await optionToken.balanceOf(
          feeHandler.target
        );
        expect(feeHandlerBalance).to.be.equal(expectedFee);
      });

      it("should correctly apply distribution partner fee share", async function () {
        const distPartner = user2;
        const mintFee = ethers.parseUnits("0.01", 18); // 1% mint fee
        const partnerFeeShare = ethers.parseUnits("0.5", 18); // 50% of mint fee goes to distribution partner
        await feeHandler.setMintFee(mintFee);
        await feeHandler.setDistPartnerFeeShares(
          [distPartner],
          [partnerFeeShare]
        );

        await underlyingToken
          .connect(user1)
          .approve(router.target, optionInfo.notional);
        const expectedFee = (optionInfo.notional * mintFee) / BASE;
        const expectedDistFee = (expectedFee * partnerFeeShare) / BASE;
        const expectedProtocolFee = expectedFee - expectedDistFee;

        await expect(
          router.connect(user1).mintOption(
            optionReceiver,
            escrowOwner,
            optionInfo,
            {
              name: "Option Name",
              symbol: "Option Symbol",
            } as DataTypes.OptionNaming,
            distPartner
          )
        ).to.emit(router, "MintOption");

        const numEscrows = await router.numEscrows();
        const optionTokenAddress = await router.getEscrows(numEscrows - 1n, 1);
        const EscrowImpl = await ethers.getContractFactory("Escrow");
        const optionToken = EscrowImpl.attach(optionTokenAddress[0]) as Escrow;

        const feeHandlerBalance = await optionToken.balanceOf(
          feeHandler.target
        );
        const distPartnerBalance = await optionToken.balanceOf(distPartner);
        expect(feeHandlerBalance).to.be.equal(expectedProtocolFee);
        expect(distPartnerBalance).to.be.equal(expectedDistFee);
      });

      it("should correctly apply 100% distribution partner fee share", async function () {
        const distPartner = user2;
        const mintFee = ethers.parseUnits("0.01", 18); // 1% mint fee
        const partnerFeeShare = ethers.parseUnits("1", 18); // 100% of mint fee goes to distribution partner
        await feeHandler.setMintFee(mintFee);
        await feeHandler.setDistPartnerFeeShares(
          [distPartner],
          [partnerFeeShare]
        );

        await underlyingToken
          .connect(user1)
          .approve(router.target, optionInfo.notional);
        const expectedFee = (optionInfo.notional * mintFee) / BASE;
        const expectedDistFee = (expectedFee * partnerFeeShare) / BASE;
        const expectedProtocolFee = expectedFee - expectedDistFee;

        await expect(
          router.connect(user1).mintOption(
            optionReceiver,
            escrowOwner,
            optionInfo,
            {
              name: "Option Name",
              symbol: "Option Symbol",
            } as DataTypes.OptionNaming,
            distPartner
          )
        ).to.emit(router, "MintOption");

        const numEscrows = await router.numEscrows();
        const optionTokenAddress = await router.getEscrows(numEscrows - 1n, 1);
        const EscrowImpl = await ethers.getContractFactory("Escrow");
        const optionToken = EscrowImpl.attach(optionTokenAddress[0]) as Escrow;

        const feeHandlerBalance = await optionToken.balanceOf(
          feeHandler.target
        );
        const distPartnerBalance = await optionToken.balanceOf(distPartner);
        expect(feeHandlerBalance).to.be.equal(expectedProtocolFee);
        expect(distPartnerBalance).to.be.equal(expectedDistFee);
      });

      it("should correctly apply both protocol and distribution partner fees", async function () {
        const distPartner = user2;
        const mintFee = ethers.parseUnits("0.02", 18); // 2% mint fee
        const partnerFeeShare = ethers.parseUnits("0.4", 18); // 40% of mint fee goes to distribution partner
        await feeHandler.setMintFee(mintFee);
        await feeHandler.setDistPartnerFeeShares(
          [distPartner],
          [partnerFeeShare]
        );

        await underlyingToken
          .connect(user1)
          .approve(router.target, optionInfo.notional);
        const expectedFee = (optionInfo.notional * mintFee) / BASE;
        const expectedDistFee = (expectedFee * partnerFeeShare) / BASE;
        const expectedProtocolFee = expectedFee - expectedDistFee;

        await expect(
          router.connect(user1).mintOption(
            optionReceiver,
            escrowOwner,
            optionInfo,
            {
              name: "Option Name",
              symbol: "Option Symbol",
            } as DataTypes.OptionNaming,
            distPartner
          )
        ).to.emit(router, "MintOption");

        const numEscrows = await router.numEscrows();
        const optionTokenAddress = await router.getEscrows(numEscrows - 1n, 1);
        const EscrowImpl = await ethers.getContractFactory("Escrow");
        const optionToken = EscrowImpl.attach(optionTokenAddress[0]) as Escrow;

        const feeHandlerBalance = await optionToken.balanceOf(
          feeHandler.target
        );
        const distPartnerBalance = await optionToken.balanceOf(distPartner);
        expect(feeHandlerBalance).to.be.equal(expectedProtocolFee);
        expect(distPartnerBalance).to.be.equal(expectedDistFee);
      });

      it("should revert in case mint fee exceeds cap", async function () {
        await expect(
          feeHandler.setMintFee(ethers.parseUnits(".200000001", 18))
        ).to.be.revertedWithCustomError(feeHandler, "InvalidMintFee");
        await expect(
          feeHandler.setMintFee(ethers.parseUnits("1.01", 18))
        ).to.be.revertedWithCustomError(feeHandler, "InvalidMintFee");
      });

      it("should revert in case non-owner tries to set mint fee", async function () {
        await expect(
          feeHandler.connect(user2).setMintFee(ethers.parseUnits(".1", 18))
        ).to.be.reverted;
      });
    });
  });

  describe("Bid Preview Revert Scenarios", function () {
    let auctionInitialization: DataTypes.AuctionInitialization;
    let escrow: any;
    let currentAsk: bigint;
    let relBid: bigint;
    let refSpot: bigint;
    let minSpot: bigint;
    let maxSpot: bigint;
    let data: any[];
    let distPartner: string;

    beforeEach(async function () {
      // Initialize auction
      refSpot = ethers.parseUnits("1", 6);
      minSpot = (refSpot * 900n) / 1000n;
      maxSpot = (refSpot * 1010n) / 1000n;
      auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        minSpot: minSpot,
        maxSpot: maxSpot,
      });

      // Deploy auction and set up environment
      escrow = await createAuction(auctionInitialization, router, owner);
      currentAsk = await escrow.currAsk();
      relBid = currentAsk;
      data = [];
      distPartner = ethers.ZeroAddress;

      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
    });

    it("should revert if auction is already successful", async function () {
      // Mocking scenario where auction was successful
      const optionReceiver = user1.address;
      await router
        .connect(user1)
        .bidOnAuction(escrow.target, optionReceiver, relBid, refSpot, data);

      const { preview } = await escrow.previewBid(relBid, refSpot, data);
      expect(preview.status).to.equal(DataTypes.BidStatus.OptionAlreadyMinted);
    });

    it("should revert if the bid is lower than the current ask", async function () {
      // Adjust relBid to be lower than currentAsk
      relBid = currentAsk - 1n;

      const { preview } = await escrow.previewBid(relBid, refSpot, data);
      expect(preview.status).to.equal(DataTypes.BidStatus.PremiumTooLow);
    });

    it("should revert if reference spot is lower than oracle spot price", async function () {
      // Mock oracle price to be higher than refSpot
      await mockOracle.setPrice(
        underlyingToken.target,
        settlementToken.target,
        ethers.parseUnits("1.5", 6)
      );

      const { preview } = await escrow.previewBid(relBid, refSpot, data);
      expect(preview.status).to.equal(DataTypes.BidStatus.SpotPriceTooLow);
    });

    it("should revert if oracle spot price is out of range", async function () {
      const auctionParams: DataTypes.AuctionParams =
        await escrow.auctionParams();
      const optionInfo: DataTypes.OptionInfo = await escrow.optionInfo();

      // Ensure correct initialization
      expect(mockOracle.target).to.be.equal(optionInfo.advancedSettings.oracle);
      expect(underlyingToken.target).to.be.equal(optionInfo.underlyingToken);
      expect(settlementToken.target).to.be.equal(optionInfo.settlementToken);

      // Mock that oracle price is right below min spot
      await mockOracle.setPrice(
        underlyingToken.target,
        settlementToken.target,
        auctionParams.minSpot - 1n
      );
      // Ensure price was set
      const price1 = await mockOracle.getPrice(
        underlyingToken.target,
        settlementToken.target,
        data
      );
      expect(price1).to.be.equal(auctionParams.minSpot - 1n);
      expect(price1).to.be.gt(0); // Price shouldn't be zero

      const [previewBelow, distPartner1] = await escrow.previewBid(
        relBid,
        price1,
        data
      );
      expect(previewBelow.status).to.equal(
        DataTypes.BidStatus.OutOfRangeSpotPrice
      );

      // Mock that oracle price is right above max spot
      await mockOracle.setPrice(
        underlyingToken.target,
        settlementToken.target,
        auctionParams.maxSpot + 1n
      );
      // Ensure price was set
      const price3 = await mockOracle.getPrice(
        underlyingToken.target,
        settlementToken.target,
        data
      );
      expect(price3).to.be.equal(auctionParams.maxSpot + 1n);

      const [previewAbove, distPartner2] = await escrow.previewBid(
        relBid,
        price3,
        data
      );
      expect(previewAbove.status).to.equal(
        DataTypes.BidStatus.OutOfRangeSpotPrice
      );
    });

    it("should not allow bidding if escrow owner called withdraw", async function () {
      // Mock scenario where the auction contract has insufficient funds
      const bal = await underlyingToken.balanceOf(escrow.target);
      await router
        .connect(owner)
        .withdraw(escrow.target, owner.address, underlyingToken.target, bal);

      const { preview } = await escrow.previewBid(relBid, refSpot, data);
      expect(preview.status).to.equal(DataTypes.BidStatus.AuctionCancelled);
    });

    it("should revert if protocol fees exceed the premium", async function () {
      const MockFeeHandler =
        await ethers.getContractFactory("MockHighFeeHandler");
      const mockFeeHandler = await MockFeeHandler.deploy(
        owner.address,
        ethers.parseEther("1.1"), // 110% match fee
        ethers.parseEther("0"),
        0n
      );

      // Set new fee handler
      await router.connect(owner).setFeeHandler(mockFeeHandler.target);

      // Set 0x as fee distributor to check fee share cap
      await mockFeeHandler
        .connect(owner)
        .setDistPartnerFeeShares(
          [ethers.ZeroAddress],
          [ethers.parseEther("1.1")]
        );

      const { preview } = await escrow.previewBid(relBid, refSpot, data);
      const expectedMaxMatchFeePct = 20n;
      const expectedMaxDistFeePct = 20n;
      const matchFeePct =
        ((preview.matchFeeProtocol + preview.matchFeeDistPartner) *
          BigInt(100)) /
        preview.premium;
      const distFeePct =
        (preview.matchFeeDistPartner * BigInt(100)) / preview.premium;
      expect(matchFeePct).to.be.equal(expectedMaxMatchFeePct);
      expect(distFeePct).to.be.equal(expectedMaxDistFeePct);

      expect(preview.status).to.equal(DataTypes.BidStatus.Success);
    });
  });

  describe("Redeem Underlying Tokens", function () {
    let auctionInitialization: DataTypes.AuctionInitialization;
    let escrow: Escrow;

    beforeEach(async function () {
      auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        earliestExerciseTenor: 0,
        borrowCap: BASE,
      });

      // Create auction and bid on it to obtain full option token supply
      escrow = await createAuction(auctionInitialization, router, owner);
      const currentAsk = await escrow.currAsk();
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.MaxUint256);
      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
          user1.address,
          currentAsk,
          ethers.parseUnits("1", 6),
          []
        );
    });

    it("should allow owner to redeem underlying tokens (1/2)", async function () {
      // Transfer all option tokens back to the owner and check event emission
      const totalSupply = await escrow.totalSupply();
      await expect(escrow.connect(user1).transfer(owner.address, totalSupply))
        .to.emit(router, "Transfer")
        .withArgs(escrow.target, user1.address, owner.address, totalSupply);
      // Check initial balances
      const underlyingBalanceBefore = await underlyingToken.balanceOf(
        owner.address
      );
      const escrowBalanceBefore = await underlyingToken.balanceOf(
        escrow.target
      );

      // Redeem underlying tokens
      await expect(escrow.connect(owner).redeem(owner.address))
        .to.emit(escrow, "Redeem")
        .withArgs(
          owner.address,
          owner.address,
          underlyingToken.target,
          escrowBalanceBefore
        );

      // Check final balances
      const underlyingBalanceAfter = await underlyingToken.balanceOf(
        owner.address
      );
      const escrowBalanceAfter = await underlyingToken.balanceOf(escrow.target);
      expect(underlyingBalanceAfter - underlyingBalanceBefore).to.equal(
        escrowBalanceBefore
      );
      expect(escrowBalanceAfter).to.equal(0);
    });

    it("should allow owner to redeem underlying tokens (2/2)", async function () {
      // Transfer some option tokens back to the owner
      const totalSupply = await escrow.totalSupply();
      const redemptionAmount = (totalSupply * 13n) / 100n;
      await escrow.connect(user1).transfer(owner.address, redemptionAmount);

      // Check initial balances
      const underlyingBalanceBefore = await underlyingToken.balanceOf(
        owner.address
      );
      const escrowBalanceBefore = await underlyingToken.balanceOf(
        escrow.target
      );

      // Redeem underlying tokens
      await expect(escrow.connect(owner).redeem(owner.address))
        .to.emit(escrow, "Redeem")
        .withArgs(
          owner.address,
          owner.address,
          underlyingToken.target,
          redemptionAmount
        );

      // Check final balances
      const underlyingBalanceAfter = await underlyingToken.balanceOf(
        owner.address
      );
      const escrowBalanceAfter = await underlyingToken.balanceOf(escrow.target);
      expect(underlyingBalanceAfter - underlyingBalanceBefore).to.equal(
        redemptionAmount
      );
      expect(escrowBalanceBefore - escrowBalanceAfter).to.equal(
        redemptionAmount
      );

      // Check new outstanding supply
      const totalSupplyAfterRedeem = await escrow.totalSupply();
      expect(totalSupplyAfterRedeem).to.equal(totalSupply - redemptionAmount);
    });

    it("should revert if a non-owner tries to redeem", async function () {
      await expect(
        escrow.connect(user1).redeem(user1.address)
      ).to.be.revertedWithCustomError(escrow, "InvalidSender");
    });

    it("should revert if there is nothing to redeem", async function () {
      // Option holder exercises option and thereby burns all supply
      await router
        .connect(user1)
        .exercise(
          escrow.target,
          user1.address,
          auctionInitialization.notional,
          true,
          []
        );

      await expect(
        escrow.connect(owner).redeem(owner.address)
      ).to.be.revertedWithCustomError(escrow, "NothingToRedeem");
    });

    it("should revert if trying to trigger transfer event with non-escrow caller", async function () {
      await expect(
        router.emitTransferEvent(owner.address, user1.address, 1n)
      ).to.be.revertedWithCustomError(router, "NotAnEscrow");
    });
  });
});
