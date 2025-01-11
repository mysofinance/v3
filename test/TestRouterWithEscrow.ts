const { expect } = require("chai");
import { ethers } from "hardhat";
import {
  Router,
  Escrow,
  MockERC20,
  MockERC20Votes,
  MockOracle,
} from "../typechain-types";
import { DataTypes } from "./DataTypes";
import {
  setupTestContracts,
  rfqSignaturePayload,
  getRFQInitialization,
  deployEscrowWithRFQ,
  getLatestTimestamp,
  getAuctionInitialization,
  createAuction,
} from "./helpers";

describe("Router And Escrow Interaction", function () {
  let router: Router;
  let escrowImpl: Escrow;
  let settlementToken: MockERC20;
  let underlyingToken: MockERC20;
  let votingUnderlyingToken: MockERC20Votes;
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
      votingUnderlyingToken,
      escrowImpl,
      router,
      mockOracle,
    } = contracts);
  });

  describe("Start Auction", function () {
    it("should allow starting an auction", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      await createAuction(auctionInitialization, router, owner);
    });
  });

  describe("Bid on Auction", function () {
    it("should allow bidding on an auction", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: String(underlyingToken.target),
        settlementToken: String(settlementToken.target),
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
          borrowCap: ethers.parseEther("1"),
          oracle: String(mockOracle.target),
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
      };

      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = ethers.parseEther("0.02");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];
      const { preview } = await escrow.previewBid(relBid, refSpot, data);

      await expect(
        router
          .connect(user1)
          .bidOnAuction(escrowAddress, user1.address, relBid, refSpot, data)
      ).to.emit(router, "BidOnAuction");
    });

    it("should revert if bidding with insufficient premium", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: String(underlyingToken.target),
        settlementToken: String(settlementToken.target),
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
          borrowCap: ethers.parseEther("1"),
          oracle: String(mockOracle.target),
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
      };

      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Approve and attempt to bid with low relBid
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const lowRelBid = ethers.parseEther("0.005"); // Below relPremiumStart
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await expect(
        router
          .connect(user1)
          .bidOnAuction(escrowAddress, user1.address, lowRelBid, refSpot, data)
      ).to.be.reverted;
    });
  });

  describe("Take Quote", function () {
    it("should allow taking a quote", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      // Approve tokens
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("100"));

      // Take the quote
      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.emit(router, "TakeQuote");
    });

    it("should revert if quote is expired (1/2)", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
      });

      // Set valid until to be in the past
      rfqInitialization.rfqQuote.validUntil = (await getLatestTimestamp()) - 1;

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      // Approve tokens
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("100"));

      // Attempt to take the expired quote
      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");
    });

    it("should revert if quote is expired (2/2)", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
      });

      // Set option expiry to be in the past
      rfqInitialization.optionInfo.expiry = (await getLatestTimestamp()) - 1;
      rfqInitialization.optionInfo.earliestExercise = 0;

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      // Approve tokens
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("100"));

      const takeQuotePreview: any = await router.previewTakeQuote(
        rfqInitialization,
        ethers.ZeroAddress
      );
      expect(takeQuotePreview.status).to.be.equal(DataTypes.RFQStatus.Expired);

      // Attempt to take the expired quote
      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");
    });
  });

  describe("Withdraw", function () {
    it("should allow owner to withdraw after auction expiry", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: String(underlyingToken.target),
        settlementToken: String(settlementToken.target),
        notional: ethers.parseEther("100"),
        auctionParams: {
          relStrike: ethers.parseEther("1"),
          tenor: 86400 * 2, // 2 days
          earliestExerciseTenor: 0,
          relPremiumStart: ethers.parseEther("0.01"),
          relPremiumFloor: ethers.parseEther("0.005"),
          decayDuration: 86400 * 7, // 7 days
          minSpot: ethers.parseUnits("0.1", 6),
          maxSpot: ethers.parseUnits("1", 6),
          decayStartTime: (await provider.getBlock("latest")).timestamp + 1,
        },
        advancedSettings: {
          borrowCap: ethers.parseEther("1"),
          oracle: String(mockOracle.target),
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
      };

      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Fast forward time to after auction expiry
      await ethers.provider.send("evm_increaseTime", [3 * 86400]);
      await ethers.provider.send("evm_mine", []);

      // Withdraw funds
      await expect(
        router
          .connect(owner)
          .withdraw(
            escrowAddress,
            owner.address,
            underlyingToken.target,
            ethers.parseEther("100")
          )
      ).to.emit(router, "Withdraw");
    });

    it("should revert if non-owner tries to withdraw", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: String(underlyingToken.target),
        settlementToken: String(settlementToken.target),
        notional: ethers.parseEther("100"),
        auctionParams: {
          relStrike: ethers.parseEther("1"),
          tenor: 86400 * 2,
          earliestExerciseTenor: 0,
          relPremiumStart: ethers.parseEther("0.01"),
          relPremiumFloor: ethers.parseEther("0.005"),
          decayDuration: 86400 * 7, // 7 days
          minSpot: ethers.parseUnits("0.1", 6),
          maxSpot: ethers.parseUnits("1", 6),
          decayStartTime: (await provider.getBlock("latest")).timestamp + 1,
        },
        advancedSettings: {
          borrowCap: ethers.parseEther("1"),
          oracle: String(mockOracle.target),
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
      };

      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Fast forward time to after auction expiry
      await ethers.provider.send("evm_increaseTime", [3 * 86400]);
      await ethers.provider.send("evm_mine", []);

      // Attempt to withdraw as non-owner
      await expect(
        router
          .connect(user1)
          .withdraw(
            escrowAddress,
            user1.address,
            underlyingToken.target,
            ethers.parseEther("100")
          )
      ).to.be.reverted;
    });
  });

  describe("Exercise Call", function () {
    it("should allow exercising a call option", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: String(underlyingToken.target),
        settlementToken: String(settlementToken.target),
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
          borrowCap: ethers.parseEther("1"),
          oracle: String(mockOracle.target),
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
      };

      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = ethers.parseEther("0.02");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await router
        .connect(user1)
        .bidOnAuction(escrowAddress, user1.address, relBid, refSpot, data);

      // Fast forward time to after earliest exercise tenor
      await ethers.provider.send("evm_increaseTime", [86400 * 7]);
      await ethers.provider.send("evm_mine", []);

      // Approve settlement token for exercise
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("10"));

      // Exercise the call
      await expect(
        router.connect(user1).exercise(
          escrowAddress,
          user1.address,
          ethers.parseEther("50"), // Exercising half the notional
          true, // Pay in settlement token
          []
        )
      ).to.emit(router, "Exercise");
    });

    it("should revert if exercising before earliest exercise tenor", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: String(underlyingToken.target),
        settlementToken: String(settlementToken.target),
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
          borrowCap: ethers.parseEther("1"),
          oracle: String(mockOracle.target),
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
      };

      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = ethers.parseEther("0.02");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await router
        .connect(user1)
        .bidOnAuction(escrowAddress, user1.address, relBid, refSpot, data);

      // Attempt to exercise before earliest exercise tenor
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("10"));

      await expect(
        router.connect(user1).exercise(
          escrowAddress,
          user1.address,
          ethers.parseEther("50"), // Exercising half the notional
          true, // Pay in settlement token
          []
        )
      ).to.be.reverted;
    });
  });

  describe("Borrow and Repay", function () {
    it("should allow borrowing and repaying (1/3)", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: String(underlyingToken.target),
        settlementToken: String(settlementToken.target),
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
          borrowCap: ethers.parseEther("1"),
          oracle: String(mockOracle.target),
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
      };

      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = ethers.parseEther("0.02");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await router
        .connect(user1)
        .bidOnAuction(escrowAddress, user1.address, relBid, refSpot, data);

      // Fast forward time to after earliest exercise tenor
      await ethers.provider.send("evm_increaseTime", [86400 * 7]);
      await ethers.provider.send("evm_mine", []);

      // Calculate expected collat amount
      const optionInfo = await escrow.optionInfo();
      const strike = optionInfo.strike;
      const underlyingBorrowAmount = ethers.parseEther("10");
      const underlyingTokenDecimals = await underlyingToken.decimals();
      const expectedCollatAmount =
        (strike * underlyingBorrowAmount) / 10n ** underlyingTokenDecimals;

      // Check pre balances
      const preUndBal = await underlyingToken.balanceOf(user1.address);
      const preSettlementBal = await settlementToken.balanceOf(user1.address);

      // Borrow underlying tokens
      await expect(
        router
          .connect(user1)
          .borrow(escrowAddress, user1.address, ethers.parseEther("10"))
      ).to.emit(router, "Borrow");

      // Check pre balances
      const postUndBal = await underlyingToken.balanceOf(user1.address);
      const postSettlementBal = await settlementToken.balanceOf(user1.address);

      expect(postUndBal - preUndBal).to.be.equal(underlyingBorrowAmount);
      expect(preSettlementBal - postSettlementBal).to.be.equal(
        expectedCollatAmount
      );

      // Check borrowed amount
      expect(await escrow.borrowedUnderlyingAmounts(user1.address)).to.equal(
        ethers.parseEther("10")
      );

      // Approve underlying token for repayment
      await underlyingToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));

      // Repay borrowed amount
      await expect(
        router
          .connect(user1)
          .repay(escrowAddress, user1.address, ethers.parseEther("10"))
      ).to.emit(router, "Repay");

      // Check borrowed amount after repayment
      expect(await escrow.borrowedUnderlyingAmounts(user1.address)).to.equal(
        ethers.parseEther("0")
      );
    });

    it("should allow borrowing and repaying (2/3)", async function () {
      const underlyingTokenDecimals = await underlyingToken.decimals();
      const settlementTokenDecimals = await settlementToken.decimals();
      const BASE = ethers.parseEther("1");
      const rfqInitialization = await getRFQInitialization({
        notionalAmount: ethers.parseUnits("250000", underlyingTokenDecimals),
        strike: ethers.parseUnits("0.45", settlementTokenDecimals),
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2500", settlementTokenDecimals),
        borrowCap: BASE,
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.MaxUint256);
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.MaxUint256);

      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.emit(router, "TakeQuote");

      // Retrieve and return the created escrow instance
      const numEscrows = await router.numEscrows();
      const escrows = await router.getEscrows(numEscrows - 1n, 1);
      const escrowAddress = escrows[0];
      const EscrowImpl = await ethers.getContractFactory("Escrow");
      const escrow = EscrowImpl.attach(escrowAddress) as Escrow;

      // Calculate expected collat amount
      const optionInfo = await escrow.optionInfo();
      const strike = optionInfo.strike;
      const underlyingBorrowAmount = rfqInitialization.optionInfo.notional;
      const expectedCollatAmount =
        (strike * underlyingBorrowAmount) / 10n ** underlyingTokenDecimals;

      // Check pre borrow balances
      const preUndBal = await underlyingToken.balanceOf(user1.address);
      const preSettlementBal = await settlementToken.balanceOf(user1.address);
      const preSettlementBalEscrow = await settlementToken.balanceOf(
        escrow.target
      );

      // Borrow underlying tokens
      await expect(
        router
          .connect(user1)
          .borrow(escrowAddress, user1.address, underlyingBorrowAmount)
      ).to.emit(router, "Borrow");

      // Check post borrow balances
      const postUndBal = await underlyingToken.balanceOf(user1.address);
      const postSettlementBal = await settlementToken.balanceOf(user1.address);
      const postSettlementBalEscrow = await settlementToken.balanceOf(
        escrow.target
      );

      expect(postUndBal - preUndBal).to.be.equal(underlyingBorrowAmount);
      expect(preSettlementBal - postSettlementBal).to.be.equal(
        expectedCollatAmount
      );
      expect(postSettlementBalEscrow - preSettlementBalEscrow).to.be.equal(
        expectedCollatAmount
      );

      // Check escrow owner cannot withdraw collateral pre expiry
      await expect(
        escrow.handleWithdraw(
          owner.address,
          settlementToken.target,
          expectedCollatAmount
        )
      ).to.be.reverted;

      // Check borrowed amount
      expect(await escrow.borrowedUnderlyingAmounts(user1.address)).to.equal(
        underlyingBorrowAmount
      );

      // Approve underlying token for repayment
      await underlyingToken
        .connect(user1)
        .approve(router.target, underlyingBorrowAmount);

      // Check pre repay balances
      const preUndBal2 = await underlyingToken.balanceOf(user1.address);
      const preSettlementBal2 = await settlementToken.balanceOf(user1.address);

      // Repay borrowed amount
      await expect(
        router
          .connect(user1)
          .repay(escrowAddress, user1.address, underlyingBorrowAmount)
      ).to.emit(router, "Repay");

      // Check post repay balances
      const postUndBal2 = await underlyingToken.balanceOf(user1.address);
      const postSettlementBal2 = await settlementToken.balanceOf(user1.address);

      expect(preUndBal2 - postUndBal2).to.be.equal(underlyingBorrowAmount);
      expect(postSettlementBal2 - preSettlementBal2).to.be.equal(
        expectedCollatAmount
      );

      // Check borrowed amount after repayment
      expect(await escrow.borrowedUnderlyingAmounts(user1.address)).to.equal(
        ethers.parseEther("0")
      );
    });

    it("should allow borrowing and repaying (3/3)", async function () {
      const underlyingTokenDecimals = await underlyingToken.decimals();
      const settlementTokenDecimals = await settlementToken.decimals();
      const BASE = ethers.parseEther("1");
      const rfqInitialization = await getRFQInitialization({
        notionalAmount: ethers.parseUnits("250000", underlyingTokenDecimals),
        strike: ethers.parseUnits("0.45", settlementTokenDecimals),
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2500", settlementTokenDecimals),
        borrowCap: BASE,
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.MaxUint256);
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.MaxUint256);

      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.emit(router, "TakeQuote");

      // Retrieve and return the created escrow instance
      const numEscrows = await router.numEscrows();
      const escrows = await router.getEscrows(numEscrows - 1n, 1);
      const escrowAddress = escrows[0];
      const EscrowImpl = await ethers.getContractFactory("Escrow");
      const escrow = EscrowImpl.attach(escrowAddress) as Escrow;

      // Calculate expected collat amount
      const optionInfo = await escrow.optionInfo();
      const strike = optionInfo.strike;
      const underlyingBorrowAmount =
        (rfqInitialization.optionInfo.notional * 3n) / 10n; // borrow 30%
      const expectedCollatAmount =
        (strike * underlyingBorrowAmount) / 10n ** underlyingTokenDecimals;

      // Check pre borrow balances
      const preUndBal = await underlyingToken.balanceOf(user1.address);
      const preSettlementBal = await settlementToken.balanceOf(user1.address);

      // Borrow underlying tokens
      await expect(
        router
          .connect(user1)
          .borrow(escrowAddress, user1.address, underlyingBorrowAmount)
      ).to.emit(router, "Borrow");

      // Check post borrow balances
      const postUndBal = await underlyingToken.balanceOf(user1.address);
      const postSettlementBal = await settlementToken.balanceOf(user1.address);

      expect(postUndBal - preUndBal).to.be.equal(underlyingBorrowAmount);
      expect(preSettlementBal - postSettlementBal).to.be.equal(
        expectedCollatAmount
      );

      // Check borrowed amount
      expect(await escrow.borrowedUnderlyingAmounts(user1.address)).to.equal(
        underlyingBorrowAmount
      );

      // Fast forward time to after expiry
      const currentTime = (await provider.getBlock("latest")).timestamp;
      await ethers.provider.send("evm_increaseTime", [
        rfqInitialization.optionInfo.expiry - currentTime + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Check collateral balance in escrow
      const preEscrowBal = await settlementToken.balanceOf(escrow.target);
      expect(preEscrowBal).to.be.gt(0);
      expect(preEscrowBal).to.be.equal(expectedCollatAmount);

      // Check pre balances
      const preOwnerBal = await settlementToken.balanceOf(owner.address);

      // Check owner can withdraw collateral amount post expiry
      await escrow.handleWithdraw(
        owner.address,
        settlementToken.target,
        expectedCollatAmount
      );

      // Check post balances
      const postEscrowBal = await settlementToken.balanceOf(escrow.target);
      const postOwnerBal = await settlementToken.balanceOf(owner.address);

      expect(postOwnerBal - preOwnerBal).to.be.equal(expectedCollatAmount);
      expect(preEscrowBal - postEscrowBal).to.be.equal(expectedCollatAmount);
    });

    it("should revert if borrowing is not allowed", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: String(underlyingToken.target),
        settlementToken: String(settlementToken.target),
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
          borrowCap: 0n, // Disallow borrowing
          oracle: String(mockOracle.target),
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
      };

      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = ethers.parseEther("0.02");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await router
        .connect(user1)
        .bidOnAuction(escrowAddress, user1.address, relBid, refSpot, data);

      // Fast forward time to after earliest exercise tenor
      await ethers.provider.send("evm_increaseTime", [86400 * 7]);
      await ethers.provider.send("evm_mine", []);

      // Attempt to borrow when borrowing is disallowed
      await expect(
        router
          .connect(user1)
          .borrow(escrowAddress, user1.address, ethers.parseEther("10"))
      ).to.be.reverted;
    });

    it("should allow withdrawing from expired auction and creating a new one (1/3)", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      const escrow = await createAuction(auctionInitialization, router, owner);
      const oldEscrowAddress = escrow.target;

      // Fast forward time to after auction expiry (30 days + 1 hour)
      await ethers.provider.send("evm_increaseTime", [86400 * 30 + 3600]);
      await ethers.provider.send("evm_mine", []);

      // revert if not an existing escrow
      await expect(
        router
          .connect(owner)
          .withdrawFromEscrowAndCreateAuction(
            user2.address,
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.be.reverted;

      // Revert if not owner
      await expect(
        router
          .connect(user1)
          .withdrawFromEscrowAndCreateAuction(
            oldEscrowAddress,
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.be.reverted;

      const preBalUser = await underlyingToken.balanceOf(owner.address);
      const preBalOldEscrow = await underlyingToken.balanceOf(oldEscrowAddress);

      // Withdraw from expired auction and create a new one
      await expect(
        router
          .connect(owner)
          .withdrawFromEscrowAndCreateAuction(
            oldEscrowAddress,
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.emit(router, "WithdrawFromEscrowAndCreateAuction");

      const postBalUser = await underlyingToken.balanceOf(owner.address);
      const postBalOldEscrow =
        await underlyingToken.balanceOf(oldEscrowAddress);

      // Check balance changes
      expect(preBalUser).to.be.equal(postBalUser);
      expect(preBalOldEscrow).to.be.gt(0);
      expect(postBalOldEscrow).to.be.equal(0);

      // Get the new escrow address
      const newEscrows = await router.getEscrows(1, 1);
      const newEscrowAddress = newEscrows[0];
      const newEscrow: any = await escrowImpl.attach(newEscrowAddress);
      const postBalNewEscrow = await underlyingToken.balanceOf(newEscrow);

      // Check balance changes
      expect(postBalNewEscrow).to.be.equal(preBalOldEscrow);

      // Verify that the new escrow is different from the old one
      expect(newEscrowAddress).to.not.equal(oldEscrowAddress);

      // Approve and bid on the new auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = ethers.parseEther("0.02");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await expect(
        router
          .connect(user1)
          .bidOnAuction(newEscrowAddress, user1.address, relBid, refSpot, data)
      ).to.emit(router, "BidOnAuction");
    });

    it("should allow withdrawing from expired auction and creating a new one (2/3)", async function () {
      let auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      const escrow = await createAuction(auctionInitialization, router, owner);
      const oldEscrowAddress = escrow.target;

      // Fast forward time to after auction expiry (30 days + 1 hour)
      await ethers.provider.send("evm_increaseTime", [86400 * 30 + 3600]);
      await ethers.provider.send("evm_mine", []);

      const preBalUser = await underlyingToken.balanceOf(owner.address);
      const preBalOldEscrow = await underlyingToken.balanceOf(oldEscrowAddress);

      // Withdraw from expired auction and create a new one with larger notional amount
      const oldNotional = auctionInitialization.notional;
      const newLargerNotional = oldNotional * 3n;
      auctionInitialization.notional = newLargerNotional;
      await expect(
        router
          .connect(owner)
          .withdrawFromEscrowAndCreateAuction(
            oldEscrowAddress,
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.emit(router, "WithdrawFromEscrowAndCreateAuction");

      const postBalUser = await underlyingToken.balanceOf(owner.address);
      const postBalOldEscrow =
        await underlyingToken.balanceOf(oldEscrowAddress);

      // Check balance changes
      expect(preBalUser - postBalUser).to.be.equal(
        newLargerNotional - oldNotional
      );
      expect(preBalOldEscrow).to.be.gt(0);
      expect(postBalOldEscrow).to.be.equal(0);

      // Get the new escrow address
      const newEscrows = await router.getEscrows(1, 1);
      const newEscrowAddress = newEscrows[0];
      const newEscrow: any = await escrowImpl.attach(newEscrowAddress);
      const postBalNewEscrow = await underlyingToken.balanceOf(newEscrow);

      // Check balance changes
      expect(postBalNewEscrow).to.be.equal(newLargerNotional);

      // Verify that the new escrow is different from the old one
      expect(newEscrowAddress).to.not.equal(oldEscrowAddress);
    });

    it("should allow withdrawing from expired auction and creating a new one (3/3)", async function () {
      let auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      const escrow = await createAuction(auctionInitialization, router, owner);
      const oldEscrowAddress = escrow.target;

      // Fast forward time to after auction expiry (30 days + 1 hour)
      await ethers.provider.send("evm_increaseTime", [86400 * 30 + 3600]);
      await ethers.provider.send("evm_mine", []);

      const preBalUser = await underlyingToken.balanceOf(owner.address);
      const preBalOldEscrow = await underlyingToken.balanceOf(oldEscrowAddress);

      // Withdraw from expired auction and create a new one with smaller notional amount
      const oldNotional = auctionInitialization.notional;
      const newSmallerNotional = oldNotional / 3n;
      auctionInitialization.notional = newSmallerNotional;
      await expect(
        router
          .connect(owner)
          .withdrawFromEscrowAndCreateAuction(
            oldEscrowAddress,
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.emit(router, "WithdrawFromEscrowAndCreateAuction");

      const postBalUser = await underlyingToken.balanceOf(owner.address);
      const postBalOldEscrow =
        await underlyingToken.balanceOf(oldEscrowAddress);

      // Check balance changes
      expect(postBalUser - preBalUser).to.be.equal(
        oldNotional - newSmallerNotional
      );
      expect(preBalOldEscrow).to.be.gt(0);
      expect(postBalOldEscrow).to.be.equal(0);

      // Get the new escrow address
      const newEscrows = await router.getEscrows(1, 1);
      const newEscrowAddress = newEscrows[0];
      const newEscrow: any = await escrowImpl.attach(newEscrowAddress);
      const postBalNewEscrow = await underlyingToken.balanceOf(newEscrow);

      // Check balance changes
      expect(postBalNewEscrow).to.be.equal(newSmallerNotional);

      // Verify that the new escrow is different from the old one
      expect(newEscrowAddress).to.not.equal(oldEscrowAddress);
    });
  });

  describe("Delegation", function () {
    it("should allow on-chain voting delegation", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(votingUnderlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        relPremiumStart: ethers.parseEther("0.01"),
        oracleAddress: String(mockOracle.target),
        votingDelegationAllowed: true,
      });
      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = ethers.parseEther("0.02");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await router
        .connect(user1)
        .bidOnAuction(escrowAddress, user1.address, relBid, refSpot, data);

      // Delegate voting
      const delegate = user2.address;
      await expect(escrow.connect(owner).handleOnChainVoting(delegate))
        .to.emit(escrow, "OnChainVotingDelegation")
        .withArgs(delegate);

      // Check revert when invalid sender tries to delegate
      await expect(
        escrow.connect(user1).handleOnChainVoting(delegate)
      ).to.be.revertedWithCustomError(escrow, "InvalidSender");
    });

    it("should revert if delegation is not allowed", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(votingUnderlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        relPremiumStart: ethers.parseEther("0.01"),
        oracleAddress: String(mockOracle.target),
      });
      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = ethers.parseEther("0.02");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await router
        .connect(user1)
        .bidOnAuction(escrowAddress, user1.address, relBid, refSpot, data);

      // Attempt to delegate voting when not allowed
      const delegate = user2.address;
      await expect(
        escrow.connect(owner).handleOnChainVoting(delegate)
      ).to.be.revertedWithCustomError(escrow, "VotingDelegationNotAllowed");
    });
  });

  describe("Set Fee Handler", function () {
    it("should allow owner to set a new fee handler", async function () {
      const newFeeHandler = user1.address;

      await expect(router.connect(owner).setFeeHandler(newFeeHandler))
        .to.emit(router, "NewFeeHandler")
        .withArgs(ethers.ZeroAddress, newFeeHandler);

      expect(await router.feeHandler()).to.equal(newFeeHandler);
    });

    it("should revert if non-owner tries to set fee handler", async function () {
      const newFeeHandler = user1.address;

      await expect(
        router.connect(user1).setFeeHandler(newFeeHandler)
      ).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    });

    it("should revert if setting the same fee handler", async function () {
      const currentFeeHandler = await router.feeHandler();

      await expect(router.connect(owner).setFeeHandler(currentFeeHandler)).to.be
        .reverted;
    });
  });

  describe("Escrow initializeAuction", function () {
    it("should revert when re-initializing", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      const escrow = await createAuction(auctionInitialization, router, owner);

      await expect(
        escrow.initializeAuction(
          router.target,
          owner.address,
          0,
          auctionInitialization,
          1,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidInitialization");
    });

    it("should revert with InvalidTokenPair", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(underlyingToken.target), // Same as underlying
        oracleAddress: String(mockOracle.target),
      });

      await expect(
        router
          .connect(owner)
          .createAuction(
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidTokenPair");
    });

    it("should revert with InvalidNotional", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        notionalAmount: 0n,
      });

      await expect(
        router
          .connect(owner)
          .createAuction(
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidNotional");
    });

    it("should revert with InvalidStrike", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        relStrike: 0n,
      });

      await expect(
        router
          .connect(owner)
          .createAuction(
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidStrike");
    });

    it("should revert with InvalidTenor", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        tenor: 0,
      });

      await expect(
        router
          .connect(owner)
          .createAuction(
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidTenor");
    });

    it("should revert with InvalidEarliestExerciseTenor", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        tenor: 86400, // 1 day
        earliestExerciseTenor: 86400, // 1 day (should be less than tenor - 1 day)
      });

      await expect(
        router
          .connect(owner)
          .createAuction(
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.be.revertedWithCustomError(
        escrowImpl,
        "InvalidEarliestExerciseTenor"
      );
    });

    it("should revert with InvalidRelPremiums", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        relPremiumStart: 0n,
        relPremiumFloor: 0n,
      });

      // rel premium start == 0
      await expect(
        router
          .connect(owner)
          .createAuction(
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidRelPremiums");

      // rel premium floor == 0
      await expect(
        router.connect(owner).createAuction(
          owner.address,
          {
            ...auctionInitialization,
            auctionParams: {
              ...auctionInitialization.auctionParams,
              relPremiumStart: 1n,
            },
          },
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidRelPremiums");

      // rel premium floor > start premium
      await expect(
        router.connect(owner).createAuction(
          owner.address,
          {
            ...auctionInitialization,
            auctionParams: {
              ...auctionInitialization.auctionParams,
              relPremiumStart: 1n,
              relPremiumFloor: 2n,
            },
          },
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidRelPremiums");
    });

    it("should revert with InvalidMinMaxSpot", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        minSpot: 2n,
        maxSpot: 1n,
      });

      // min spot > max spot
      await expect(
        router
          .connect(owner)
          .createAuction(
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidMinMaxSpot");

      // max spot = 0
      await expect(
        router.connect(owner).createAuction(
          owner.address,
          {
            ...auctionInitialization,
            auctionParams: {
              ...auctionInitialization.auctionParams,
              maxSpot: 0n,
              minSpot: 0n,
            },
          },
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidMinMaxSpot");
    });

    it("should revert with InvalidOracle", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: ethers.ZeroAddress,
      });

      await expect(
        router
          .connect(owner)
          .createAuction(
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidOracle");
    });

    it("should revert with InvalidBorrowCap", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        borrowCap: ethers.parseEther("1.1"), // 110%, which is > BASE (100%)
      });

      await expect(
        router
          .connect(owner)
          .createAuction(
            owner.address,
            auctionInitialization,
            ethers.ZeroAddress
          )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidBorrowCap");
    });

    it("should revert when bidding with invalid parameters", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      const escrow = await createAuction(auctionInitialization, router, owner);

      // Attempt to bid with invalid parameters (e.g., zero relBid)
      await expect(
        router.connect(user1).bidOnAuction(
          escrow.target,
          user1.address,
          0, // Invalid relBid
          ethers.parseUnits("1", 6),
          []
        )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidBid");
    });
  });

  describe("Escrow initializeRFQMatch", function () {
    it("should revert when re-initializing", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6),
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      // Approve tokens
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("100"));

      const escrow = await deployEscrowWithRFQ(
        rfqInitialization,
        router,
        owner,
        escrowImpl
      );

      await expect(
        escrow.initializeRFQMatch(
          router.target,
          owner.address,
          user1.address,
          0,
          rfqInitialization,
          1
        )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidInitialization");
    });

    it("should revert with InvalidTakeQuote if underlying and settlement token are the same", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(underlyingToken.target), // Same as underlying
        premium: ethers.parseUnits("2", 6),
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("100"));

      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");
    });

    it("should revert with InvalidTakeQuote if notional is zero", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6),
        notionalAmount: 0n,
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("100"));

      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");
    });

    it("should revert with InvalidTakeQuote if strike is zero", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6),
        strike: 0n,
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("100"));

      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");
    });

    it("should revert with InvalidTakeQuote if expiry is in the past", async function () {
      const shortTenor = 3600; // 1 hour
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6),
        tenor: shortTenor,
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("100"));

      // Advance time beyond the expiry
      await ethers.provider.send("evm_increaseTime", [shortTenor + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");
    });

    it("should revert with InvalidTakeQuote if earliest exercise is too close to expiry", async function () {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6),
        tenor: 86400, // 1 day in the future
        earliestExerciseTenor: currentTimestamp + 86400 - 3600, // 1 hour before expiry
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("100"));

      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");
    });

    it("should revert with InvalidTakeQuote if borrow cap > BASE", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6),
        borrowCap: ethers.parseEther("1.1"), // 110%, which is > BASE (100%)
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("100"));

      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");
    });

    it("should successfully initialize RFQ match with valid parameters", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6),
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("100"));

      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.emit(router, "TakeQuote");
    });
  });

  describe("Escrow handleAuctionBid and handleExercise", function () {
    let escrow: any;
    let auctionInitialization: DataTypes.AuctionInitialization;

    beforeEach(async function () {
      auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      escrow = await createAuction(auctionInitialization, router, owner);
    });

    describe("handleAuctionBid", function () {
      it("should revert with InvalidSender if not called by router", async function () {
        await expect(
          escrow
            .connect(user1)
            .handleAuctionBid(
              ethers.parseEther("0.1"),
              user1.address,
              ethers.parseUnits("1", 6),
              []
            )
        ).to.be.revertedWithCustomError(escrow, "InvalidSender");
      });

      it("should revert with InvalidBid if bid preview is not successful", async function () {
        // Assuming a very low bid will result in an unsuccessful preview
        await expect(
          router.connect(user1).bidOnAuction(
            escrow.target,
            user1.address,
            ethers.parseEther("0.000001"), // Very low bid
            ethers.parseUnits("1", 6),
            []
          )
        ).to.be.revertedWithCustomError(escrow, "InvalidBid");
      });

      it("should successfully handle a valid bid", async function () {
        await settlementToken.mint(user1.address, ethers.parseEther("1000"));
        await settlementToken
          .connect(user1)
          .approve(router.target, ethers.parseEther("1000"));

        await expect(
          router.connect(user1).bidOnAuction(
            escrow.target,
            user1.address,
            ethers.parseEther("0.1"), // Valid bid
            ethers.parseUnits("1", 6),
            []
          )
        ).to.emit(router, "BidOnAuction");

        expect(await escrow.optionMinted()).to.be.true;
      });

      it("should revert on exercise without successful bid", async function () {
        await expect(
          router
            .connect(user1)
            .exercise(
              escrow.target,
              user1.address,
              ethers.parseEther("1"),
              true,
              []
            )
        ).to.be.revertedWithCustomError(escrowImpl, "NoOptionMinted");
      });
    });

    describe("handleExercise", function () {
      beforeEach(async function () {
        // Setup a successful bid first
        await settlementToken.mint(user1.address, ethers.parseEther("1000"));
        await settlementToken
          .connect(user1)
          .approve(router.target, ethers.parseEther("1000"));

        await router
          .connect(user1)
          .bidOnAuction(
            escrow.target,
            user1.address,
            ethers.parseEther("0.1"),
            ethers.parseUnits("1", 6),
            []
          );
      });

      it("should revert with InvalidSender if not called by router", async function () {
        await expect(
          escrow
            .connect(user1)
            .handleExercise(
              user1.address,
              user1.address,
              ethers.parseEther("1"),
              true,
              []
            )
        ).to.be.revertedWithCustomError(escrow, "InvalidSender");
      });

      it("should revert with InvalidExerciseTime if exercised too early", async function () {
        await expect(
          router
            .connect(user1)
            .exercise(
              escrow.target,
              user1.address,
              ethers.parseEther("1"),
              true,
              []
            )
        ).to.be.revertedWithCustomError(escrow, "InvalidExerciseTime");
      });

      it("should revert with InvalidExerciseTime if exercised after expiry", async function () {
        const optionInfo = await escrow.optionInfo();
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          Number(optionInfo.expiry) + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await expect(
          router
            .connect(user1)
            .exercise(
              escrow.target,
              user1.address,
              ethers.parseEther("1"),
              true,
              []
            )
        ).to.be.revertedWithCustomError(escrow, "InvalidExerciseTime");
      });

      it("should revert with InvalidExerciseAmount if amount is zero", async function () {
        const optionInfo = await escrow.optionInfo();
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          Number(optionInfo.earliestExercise) + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await expect(
          router
            .connect(user1)
            .exercise(escrow.target, user1.address, 0, true, [])
        ).to.be.revertedWithCustomError(escrow, "InvalidExerciseAmount");
      });

      it("should revert with InvalidExerciseAmount if amount exceeds notional", async function () {
        const optionInfo = await escrow.optionInfo();
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          Number(optionInfo.earliestExercise) + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await expect(
          router
            .connect(user1)
            .exercise(
              escrow.target,
              user1.address,
              optionInfo.notional + 1n,
              true,
              []
            )
        ).to.be.revertedWithCustomError(escrow, "InvalidExerciseAmount");
      });

      it("should revert if exercising with underlying token but exercise cost is zero", async function () {
        const optionInfo = await escrow.optionInfo();
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          Number(optionInfo.earliestExercise) + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        // Set artificially low mock price for settlement token, denominated in underlying token
        await mockOracle.setPrice(
          settlementToken.target,
          underlyingToken.target,
          1
        );

        await expect(
          router
            .connect(user1)
            .exercise(escrow.target, user1.address, 1, false, [])
        ).to.be.revertedWithCustomError(escrow, "InvalidExercise");
      });

      it("should revert if exercising with underlying token but exercise cost is zero", async function () {
        const optionInfo: DataTypes.OptionInfo = await escrow.optionInfo();
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          Number(optionInfo.earliestExercise) + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        // Calculate break-even price at option becomes out-of-the-money
        const underlyingTokenDecimals = await underlyingToken.decimals();
        const settlementTokenDecimals = await settlementToken.decimals();
        const priceOfSettlementTokenInUnderlying =
          (ethers.parseUnits("1", underlyingTokenDecimals) *
            10n ** settlementTokenDecimals) /
          optionInfo.strike;

        // To make option be out-of-the-money an underlying units needs to be
        // worth less than strike; since here price is denominated in underlying
        // the price needs to be increased (if price was denominated in settlement
        // token one would need to decrease)
        const otmPrice = priceOfSettlementTokenInUnderlying + 1n;
        await mockOracle.setPrice(
          settlementToken.target,
          underlyingToken.target,
          otmPrice
        );

        // Assume user wants to exercise on whole notional amount
        const exerciseCostInSettlementToken =
          (optionInfo.strike * optionInfo.notional) /
          10n ** underlyingTokenDecimals;
        const exerciseCostInUnderlyingToken =
          (exerciseCostInSettlementToken * otmPrice) /
          10n ** settlementTokenDecimals;

        // Check that expected exercise cost in underlying tokens would be less than notional
        expect(exerciseCostInUnderlyingToken).to.be.gt(optionInfo.notional);

        await expect(
          router
            .connect(user1)
            .exercise(
              escrow.target,
              user1.address,
              optionInfo.notional,
              false,
              []
            )
        ).to.be.revertedWithCustomError(escrow, "InvalidExercise");
      });

      it("should successfully handle a valid exercise", async function () {
        const optionInfo = await escrow.optionInfo();
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          Number(optionInfo.earliestExercise) + 1,
        ]);
        await ethers.provider.send("evm_mine", []);

        await settlementToken.mint(user1.address, ethers.parseEther("1000"));
        await settlementToken
          .connect(user1)
          .approve(router.target, ethers.parseEther("1000"));

        await expect(
          router
            .connect(user1)
            .exercise(
              escrow.target,
              user1.address,
              optionInfo.notional,
              true,
              []
            )
        ).to.emit(router, "Exercise");
      });
    });
  });

  describe("Escrow handleBorrow", function () {
    let escrow: any;
    let auctionInitialization: DataTypes.AuctionInitialization;

    beforeEach(async function () {
      auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        borrowCap: ethers.parseEther("0.5"), // 50% borrow cap
      });
      escrow = await createAuction(auctionInitialization, router, owner);

      // Setup a successful bid
      await settlementToken.mint(user1.address, ethers.parseEther("1000"));
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000"));

      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
          user1.address,
          ethers.parseEther("0.1"),
          ethers.parseUnits("1", 6),
          []
        );
    });

    it("should revert with InvalidSender if not called by router", async function () {
      await expect(
        escrow
          .connect(user1)
          .handleBorrow(user1.address, user1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(escrow, "InvalidSender");
    });

    it("should revert with NoOptionMinted if option is not minted", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      const newEscrow = await createAuction(
        auctionInitialization,
        router,
        owner
      );

      await expect(
        router
          .connect(user1)
          .borrow(newEscrow.target, user1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(newEscrow, "NoOptionMinted");
    });

    it("should revert with InvalidBorrowTime if borrowed too early", async function () {
      await expect(
        router
          .connect(user1)
          .borrow(escrow.target, user1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(escrow, "InvalidBorrowTime");
    });

    it("should revert with InvalidBorrowTime if borrowed after expiry", async function () {
      const optionInfo = await escrow.optionInfo();
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Number(optionInfo.expiry) + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        router
          .connect(user1)
          .borrow(escrow.target, user1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(escrow, "InvalidBorrowTime");
    });

    it("should revert with InvalidBorrowAmount if amount is zero", async function () {
      const optionInfo = await escrow.optionInfo();
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Number(optionInfo.earliestExercise) + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        router.connect(user1).borrow(escrow.target, user1.address, 0)
      ).to.be.revertedWithCustomError(escrow, "InvalidBorrowAmount");
    });

    it("should revert with InvalidBorrowAmount if amount exceeds borrow cap", async function () {
      const optionInfo = await escrow.optionInfo();
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Number(optionInfo.earliestExercise) + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      const borrowCapExceeded =
        (optionInfo.notional *
          BigInt(auctionInitialization.advancedSettings.borrowCap)) /
          ethers.parseEther("1") +
        1n;

      await expect(
        router
          .connect(user1)
          .borrow(escrow.target, user1.address, borrowCapExceeded)
      ).to.be.revertedWithCustomError(escrow, "InvalidBorrowAmount");
    });

    it("should successfully handle a valid borrow", async function () {
      const optionInfo = await escrow.optionInfo();
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Number(optionInfo.earliestExercise) + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      const validBorrowAmount =
        (optionInfo.notional *
          BigInt(auctionInitialization.advancedSettings.borrowCap)) /
        ethers.parseEther("1");

      await settlementToken.mint(user1.address, ethers.parseEther("1000"));
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000"));

      await expect(
        router
          .connect(user1)
          .borrow(escrow.target, user1.address, validBorrowAmount)
      ).to.emit(router, "Borrow");

      const borrowedAmount = await escrow.borrowedUnderlyingAmounts(
        user1.address
      );
      expect(borrowedAmount).to.equal(validBorrowAmount);
    });
  });

  describe("Escrow handleRepay", function () {
    let escrow: any;
    let auctionInitialization: DataTypes.AuctionInitialization;

    beforeEach(async function () {
      auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        borrowCap: ethers.parseEther("0.5"), // 50% borrow cap
        tenor: 60 * 60 * 24 * 30,
        earliestExerciseTenor: 60 * 60 * 24,
      });
      escrow = await createAuction(auctionInitialization, router, owner);

      // Setup a successful bid
      await settlementToken.mint(user1.address, ethers.parseEther("1000"));
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000"));

      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
          user1.address,
          ethers.parseEther("0.1"),
          ethers.parseUnits("1", 6),
          []
        );

      // Setup a successful borrow
      const optionInfo = await escrow.optionInfo();
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Number(optionInfo.earliestExercise) + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      const validBorrowAmount =
        (optionInfo.notional *
          BigInt(auctionInitialization.advancedSettings.borrowCap)) /
        ethers.parseEther("1");

      await router
        .connect(user1)
        .borrow(escrow.target, user1.address, validBorrowAmount);
    });

    it("should revert with InvalidSender if not called by router", async function () {
      await expect(
        escrow
          .connect(user1)
          .handleRepay(user1.address, user1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(escrow, "InvalidSender");
    });

    it("should revert with NoOptionMinted if option is not minted", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      const newEscrow = await createAuction(
        auctionInitialization,
        router,
        owner
      );

      await expect(
        router
          .connect(user1)
          .repay(newEscrow.target, user1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(newEscrow, "NoOptionMinted");
    });

    it("should revert with InvalidRepayTime if repay called after expiry", async function () {
      const optionInfo = await escrow.optionInfo();
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Number(optionInfo.expiry) + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        router
          .connect(user1)
          .repay(escrow.target, user1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(escrow, "InvalidRepayTime");
    });

    it("should revert with InvalidRepayAmount if amount is zero", async function () {
      await expect(
        router.connect(user1).repay(escrow.target, user1.address, 0)
      ).to.be.revertedWithCustomError(escrow, "InvalidRepayAmount");
    });

    it("should revert with InvalidRepayAmount if amount exceeds borrowed amount", async function () {
      const borrowedAmount = await escrow.borrowedUnderlyingAmounts(
        user1.address
      );
      const excessiveRepayAmount = borrowedAmount + 1n;

      await expect(
        router
          .connect(user1)
          .repay(escrow.target, user1.address, excessiveRepayAmount)
      ).to.be.revertedWithCustomError(escrow, "InvalidRepayAmount");
    });

    it("should revert with NothingToRepay if totalBorrowed is zero", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        borrowCap: 0n, // Set borrow cap to 0
      });
      const newEscrow = await createAuction(
        auctionInitialization,
        router,
        owner
      );

      // Mint tokens and approve
      await settlementToken.mint(user1.address, ethers.parseEther("1000"));
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000"));

      // Place a successful bid to mint the option
      await router
        .connect(user1)
        .bidOnAuction(
          newEscrow.target,
          user1.address,
          auctionInitialization.auctionParams.relPremiumStart,
          ethers.parseUnits("1", 6),
          []
        );

      // Ensure the option is minted
      expect(await newEscrow.optionMinted()).to.be.true;

      // Fast forward to earliest exercise time
      const optionInfo = await newEscrow.optionInfo();

      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Number(optionInfo.earliestExercise) + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Attempt to repay
      await expect(
        router
          .connect(user1)
          .repay(newEscrow.target, user1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(newEscrow, "NothingToRepay");
    });

    it("should successfully handle a valid repay", async function () {
      const borrowedAmount = await escrow.borrowedUnderlyingAmounts(
        user1.address
      );
      const repayAmount = borrowedAmount / 2n;

      await underlyingToken.mint(user1.address, repayAmount);
      await underlyingToken.connect(user1).approve(router.target, repayAmount);

      await expect(
        router.connect(user1).repay(escrow.target, user1.address, repayAmount)
      ).to.emit(router, "Repay");

      const remainingBorrowedAmount = await escrow.borrowedUnderlyingAmounts(
        user1.address
      );
      expect(remainingBorrowedAmount).to.equal(borrowedAmount - repayAmount);
    });
  });

  describe("Escrow transfer ownership", function () {
    let escrow: any;
    let auctionInitialization: DataTypes.AuctionInitialization;

    beforeEach(async function () {
      auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      escrow = await createAuction(auctionInitialization, router, owner);

      // Setup a successful bid
      await settlementToken.mint(user1.address, ethers.parseEther("1000"));
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000"));

      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
          user1.address,
          ethers.parseEther("0.1"),
          ethers.parseUnits("1", 6),
          []
        );
    });

    it("should allow the owner to transfer ownership to a new address", async function () {
      const newOwner = user2;
      await expect(escrow.connect(owner).transferOwnership(newOwner.address))
        .to.emit(escrow, "TransferOwnership")
        .withArgs(owner.address, owner.address, newOwner.address);
      expect(await escrow.owner()).to.equal(newOwner.address);

      // check transfer ownership event is also emitted on router level
      await expect(escrow.connect(newOwner).transferOwnership(owner.address))
        .to.emit(router, "TransferOwnership")
        .withArgs(escrow.target, newOwner.address, owner.address);
      expect(await escrow.owner()).to.equal(owner.address);

      // @dev: should revert when trying to emit transferOwnership with non escrow caller
      await expect(
        router
          .connect(owner)
          .emitTransferOwnershipEvent(owner.address, newOwner.address)
      ).to.be.revertedWithCustomError(router, "NotAnEscrow");
    });

    it("should revert if a non-owner tries to transfer ownership", async function () {
      const newOwner = user2.address;
      await expect(
        escrow.connect(user1).transferOwnership(newOwner)
      ).to.be.revertedWithCustomError(escrow, "InvalidSender");
    });

    it("should revert if the new owner is the same as the current owner", async function () {
      const currentOwner = await escrow.owner();
      await expect(
        escrow.connect(owner).transferOwnership(currentOwner)
      ).to.be.revertedWithCustomError(escrow, "OwnerAlreadySet");
    });
  });

  describe("Escrow handleWithdraw", function () {
    let escrow: any;
    let auctionInitialization: DataTypes.AuctionInitialization;

    beforeEach(async function () {
      auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });
      escrow = await createAuction(auctionInitialization, router, owner);

      // Setup a successful bid
      await settlementToken.mint(user1.address, ethers.parseEther("1000"));
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000"));

      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
          user1.address,
          ethers.parseEther("0.1"),
          ethers.parseUnits("1", 6),
          []
        );
    });

    it("should allow the owner to withdraw after option expiry", async function () {
      // Fast forward time to after expiry
      const optionInfo = await escrow.optionInfo();
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Number(optionInfo.expiry) + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      const withdrawAmount = optionInfo.notional;

      const userBalPreWithdrawal = await underlyingToken.balanceOf(
        user1.address
      );
      await expect(
        escrow
          .connect(owner)
          .handleWithdraw(user1.address, underlyingToken.target, withdrawAmount)
      )
        .to.emit(escrow, "Withdraw")
        .withArgs(
          owner.address,
          user1.address,
          underlyingToken.target,
          withdrawAmount
        );
      const userBalPostWithdrawal = await underlyingToken.balanceOf(
        user1.address
      );

      // Check the balances to confirm the transfer
      expect(userBalPostWithdrawal - userBalPreWithdrawal).to.equal(
        withdrawAmount
      );
    });

    it("should revert if a non-owner or non-router tries to withdraw", async function () {
      const optionInfo = await escrow.optionInfo();
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Number(optionInfo.expiry) + 1,
      ]);
      await ethers.provider.send("evm_mine", []);

      const withdrawAmount = optionInfo.notional;
      await expect(
        escrow
          .connect(user1)
          .handleWithdraw(user1.address, underlyingToken.target, withdrawAmount)
      ).to.be.revertedWithCustomError(escrow, "InvalidSender");
    });

    it("should revert if withdrawal is attempted before expiry when option is minted", async function () {
      const optionInfo = await escrow.optionInfo();
      const withdrawAmount = optionInfo.notional;

      await expect(
        escrow
          .connect(owner)
          .handleWithdraw(owner.address, underlyingToken.target, withdrawAmount)
      ).to.be.revertedWithCustomError(escrow, "InvalidWithdraw");
    });
  });

  describe("Escrow handleOffChainVoting", function () {
    let escrow: any;
    let delegateRegistry: any;
    let auctionInitialization: DataTypes.AuctionInitialization;

    beforeEach(async function () {
      // Deploy a MockDelegateRegistry for testing
      const DelegateRegistry = await ethers.getContractFactory(
        "MockDelegateRegistry"
      );
      delegateRegistry = await DelegateRegistry.deploy();

      auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        allowedDelegateRegistry: delegateRegistry.target,
      });
      escrow = await createAuction(auctionInitialization, router, owner);

      // Setup a successful bid
      await settlementToken.mint(user1.address, ethers.parseEther("1000"));
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000"));

      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
          user1.address,
          ethers.parseEther("0.1"),
          ethers.parseUnits("1", 6),
          []
        );
    });

    it("should allow the owner to delegate off-chain voting", async function () {
      const spaceId = ethers.encodeBytes32String("space1");
      const delegate = user2.address;

      await expect(
        escrow.connect(owner).handleOffChainVoting(spaceId, delegate)
      )
        .to.emit(escrow, "OffChainVotingDelegation")
        .withArgs(delegateRegistry.target, spaceId, delegate);

      // Check the delegation in the MockDelegateRegistry
      expect(
        await delegateRegistry.delegation(escrow.target, spaceId)
      ).to.equal(delegate);
    });

    it("should revert if a non-owner tries to delegate", async function () {
      const spaceId = ethers.encodeBytes32String("space1");
      const delegate = user2.address;

      await expect(
        escrow.connect(user1).handleOffChainVoting(spaceId, delegate)
      ).to.be.revertedWithCustomError(escrow, "InvalidSender");
    });

    it("should revert if no allowed delegate registry is set", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        allowedDelegateRegistry: ethers.ZeroAddress,
      });
      escrow = await createAuction(auctionInitialization, router, owner);

      // Setup a successful bid
      await settlementToken.mint(user1.address, ethers.parseEther("1000"));
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("1000"));

      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
          user1.address,
          ethers.parseEther("0.1"),
          ethers.parseUnits("1", 6),
          []
        );

      const spaceId = ethers.encodeBytes32String("space1");
      const delegate = user2.address;

      await expect(
        escrow.connect(owner).handleOffChainVoting(spaceId, delegate)
      ).to.be.revertedWithCustomError(escrow, "NoAllowedDelegateRegistry");
    });
  });

  describe("Edge Cases and Reverts", function () {
    it("should push new escrow to array when creating second identical auction", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        notionalAmount: ethers.parseEther("100") / 2n,
        relStrike: ethers.parseEther("1"),
        relPremiumStart: ethers.parseEther("0.01"),
        oracleAddress: String(mockOracle.target),
      });
      expect(await router.numEscrows()).to.be.equal(0);

      const escrow1 = await createAuction(auctionInitialization, router, owner);
      expect(await router.numEscrows()).to.be.equal(1);

      const escrow2 = await createAuction(auctionInitialization, router, owner);
      expect(await router.numEscrows()).to.be.equal(2);

      // Fetch both escrows and ensure they are unique
      const escrows = await router.getEscrows(0, 2);
      expect(escrow1.target).to.not.equal(escrow2.target);
      expect(escrow1.target).to.be.equal(escrows[0]);
      expect(escrow2.target).to.be.equal(escrows[1]);
    });

    it("should revert when non-escrow address tries to interact", async function () {
      // Attempt to interact with a random address
      await expect(
        router
          .connect(user1)
          .withdraw(
            user2.address,
            user1.address,
            underlyingToken.target,
            ethers.parseEther("10")
          )
      ).to.be.revertedWithCustomError;
    });

    it("should revert when bidding on non-existent escrow", async function () {
      const nonExistentEscrow = ethers.Wallet.createRandom().address;

      await expect(
        router
          .connect(user1)
          .bidOnAuction(
            nonExistentEscrow,
            user1.address,
            ethers.parseEther("0.1"),
            ethers.parseUnits("1", 6),
            []
          )
      ).to.be.reverted;
    });

    it("should revert when exercising on non-existent escrow", async function () {
      const nonExistentEscrow = ethers.Wallet.createRandom().address;

      await expect(
        router
          .connect(user1)
          .exercise(
            nonExistentEscrow,
            user1.address,
            ethers.parseEther("10"),
            false,
            []
          )
      ).to.be.reverted;
    });

    it("should revert when borrowing from non-existent escrow", async function () {
      const nonExistentEscrow = ethers.Wallet.createRandom().address;

      await expect(
        router
          .connect(user1)
          .borrow(nonExistentEscrow, user1.address, ethers.parseEther("10"))
      ).to.be.reverted;
    });

    it("should revert when repaying to non-existent escrow", async function () {
      const nonExistentEscrow = ethers.Wallet.createRandom().address;

      await expect(
        router
          .connect(user1)
          .repay(nonExistentEscrow, user1.address, ethers.parseEther("10"))
      ).to.be.reverted;
    });

    it("should revert with InvalidGetEscrowsQuery for invalid queries", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        relPremiumStart: ethers.parseEther("0.01"),
        oracleAddress: String(mockOracle.target),
      });

      // Create several escrows
      for (let i = 0; i < 3; i++) {
        await createAuction(auctionInitialization, router, owner);
      }

      const numEscrows = await router.numEscrows();
      expect(numEscrows).to.equal(3);

      // Case 1: numElements is 0
      await expect(router.getEscrows(0, 0)).to.be.revertedWithCustomError(
        router,
        "InvalidGetEscrowsQuery"
      );

      // Case 2: from + numElements > length
      await expect(router.getEscrows(2, 3)).to.be.revertedWithCustomError(
        router,
        "InvalidGetEscrowsQuery"
      );

      // Verify that a valid query still works
      const validEscrows = await router.getEscrows(0, 3);
      expect(validEscrows.length).to.equal(3);
    });
  });
});
