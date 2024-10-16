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
} from "./testHelpers";

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
});
