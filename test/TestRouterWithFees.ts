import { expect } from "chai";
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
  rfqSignaturePayload,
  getRFQInitialization,
  getAuctionInitialization,
  createAuction,
} from "./helpers";

describe("Router Contract Fee Tests", function () {
  let router: Router;
  let settlementToken: MockERC20;
  let underlyingToken: MockERC20;
  let mockOracle: MockOracle;
  let feeHandler: FeeHandler;
  let owner: any;
  let user1: any;
  let user2: any;
  let provider: any;
  const CHAIN_ID = 31337;
  const BASE = ethers.parseEther("1");
  const MAX_MATCH_FEE = ethers.parseEther("0.2");
  const MAX_EXERCISE_FEE = ethers.parseEther("0.005");

  beforeEach(async function () {
    const contracts = await setupTestContracts();
    ({
      owner,
      user1,
      user2,
      provider,
      settlementToken,
      underlyingToken,
      router,
      mockOracle,
    } = contracts);
    // Deploy FeeHandler
    const FeeHandler = await ethers.getContractFactory("FeeHandler");
    feeHandler = await FeeHandler.deploy(
      owner.address,
      router.target,
      ethers.parseEther("0.01"), // 1% match fee
      ethers.parseEther("0.001") // 0.1% exercise fee
    );

    await router.connect(owner).setFeeHandler(feeHandler.target);

    await mockOracle.setPrice(
      settlementToken.target,
      underlyingToken.target,
      ethers.parseUnits("1", 18)
    );
  });

  describe("Access Control", function () {
    it("Should allow only owner to call withdraw", async function () {
      // Attempt withdraw from non-owner
      await expect(
        feeHandler
          .connect(user1)
          .withdraw(
            user1.address,
            underlyingToken.target,
            ethers.parseEther("10")
          )
      ).to.be.revertedWithCustomError(feeHandler, "OwnableUnauthorizedAccount");

      const initialOwnerBalance = await underlyingToken.balanceOf(
        owner.address
      );

      await underlyingToken
        .connect(user2)
        .transfer(feeHandler.target, ethers.parseEther("10"));
      // Owner can withdraw
      await expect(
        feeHandler
          .connect(owner)
          .withdraw(
            owner.address,
            underlyingToken.target,
            ethers.parseEther("10")
          )
      )
        .to.emit(feeHandler, "Withdraw")
        .withArgs(
          owner.address,
          underlyingToken.target,
          ethers.parseEther("10")
        );

      const finalOwnerBalance = await underlyingToken.balanceOf(owner.address);

      // Check balance
      expect(finalOwnerBalance - initialOwnerBalance).to.equal(
        ethers.parseEther("10")
      );
    });

    it("Should allow only owner to setMatchFeeInfo", async function () {
      // Attempt to setMatchFeeInfo from non-owner
      await expect(
        feeHandler.connect(user1).setMatchFee(ethers.parseEther("0.05"))
      ).to.be.revertedWithCustomError(feeHandler, "OwnableUnauthorizedAccount");

      // Owner sets matchFeeInfo
      await expect(
        feeHandler.connect(owner).setMatchFee(ethers.parseEther("0.05"))
      )
        .to.emit(feeHandler, "SetMatchFee")
        .withArgs(ethers.parseEther("0.05"));

      // Verify changes
      const matchFeeInfo = await feeHandler.getMatchFeeInfo(user1.address);
      expect(matchFeeInfo._matchFee).to.equal(ethers.parseEther("0.05"));
      expect(matchFeeInfo._matchFeeDistPartnerShare).to.equal(0); // addr1 is not a distPartner
    });

    it("Should allow only owner to setExerciseFee", async function () {
      // Attempt to setExerciseFee from non-owner
      await expect(
        feeHandler.connect(user1).setExerciseFee(ethers.parseEther("0.002"))
      ).to.be.revertedWithCustomError(feeHandler, "OwnableUnauthorizedAccount");

      // Owner sets exerciseFee
      await expect(
        feeHandler.connect(owner).setExerciseFee(ethers.parseEther("0.002"))
      )
        .to.emit(feeHandler, "SetExerciseFee")
        .withArgs(ethers.parseEther("0.002"));

      // Verify change
      expect(await feeHandler.exerciseFee()).to.equal(
        ethers.parseEther("0.002")
      );
    });

    it("Should allow only owner to setDistPartners", async function () {
      const accounts = [user1.address, user2.address];
      const feesShares = [BASE, BASE / 2n];

      // Attempt to setDistPartners from non-owner
      await expect(
        feeHandler.connect(user1).setDistPartnerFeeShares(accounts, feesShares)
      ).to.be.revertedWithCustomError(feeHandler, "OwnableUnauthorizedAccount");

      // Owner sets distPartners
      await expect(
        feeHandler.connect(owner).setDistPartnerFeeShares(accounts, feesShares)
      )
        .to.emit(feeHandler, "SetDistPartnerFeeShares")
        .withArgs(accounts, feesShares);

      // Verify changes
      expect(await feeHandler.distPartnerFeeShare(user1.address)).to.be.equal(
        feesShares[0]
      );
      expect(await feeHandler.distPartnerFeeShare(user2.address)).to.be.equal(
        feesShares[1]
      );
    });

    it("Should allow only router to call provisionFees", async function () {
      // Attempt to call provisionFees from non-router
      await expect(
        feeHandler
          .connect(user1)
          .provisionFees(underlyingToken.target, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(feeHandler, "InvalidSender");
    });
  });

  describe("Fees in Auction", function () {
    it("should apply correct fees when bidding on an auction", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        relPremiumStart: ethers.parseEther("0.01"),
        oracleAddress: String(mockOracle.target),
      });

      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Approve settlement token for bidding and fees
      const bidAmount = ethers.parseEther("2"); // 2% of notional
      await settlementToken.connect(user1).approve(router.target, bidAmount);

      const relBid = ethers.parseEther("0.02");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      // Get initial balances
      const initialOwnerBalance = await settlementToken.balanceOf(
        owner.address
      );
      const initialUser1Balance = await settlementToken.balanceOf(
        user1.address
      );
      const initialFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Bid on auction
      await router
        .connect(user1)
        .bidOnAuction(
          escrowAddress,
          user1.address,
          relBid,
          refSpot,
          data,
          ethers.ZeroAddress
        );

      // Get final balances
      const finalOwnerBalance = await settlementToken.balanceOf(owner.address);
      const finalUser1Balance = await settlementToken.balanceOf(user1.address);
      const finalFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Calculate expected fees
      const expectedMatchFee =
        (auctionInitialization.auctionParams.relPremiumStart *
          refSpot *
          ethers.parseEther("0.01") *
          auctionInitialization.notional) /
        (BASE * BASE * BASE);

      // Check balances
      expect(finalOwnerBalance).to.be.gt(initialOwnerBalance);
      expect(finalUser1Balance).to.be.lt(initialUser1Balance);
      expect(finalFeeHandlerBalance).to.equal(
        initialFeeHandlerBalance + expectedMatchFee
      );
    });
    it("should apply correct fees when borrowing", async function () {
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        borrowCap: ethers.parseEther("1"),
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
        .bidOnAuction(
          escrowAddress,
          user1.address,
          relBid,
          refSpot,
          data,
          ethers.ZeroAddress
        );

      // Fast forward time to after earliest exercise tenor
      await ethers.provider.send("evm_increaseTime", [86400 * 7]);
      await ethers.provider.send("evm_mine", []);

      // Set borrow fee (same as exercise fee for this test)
      await feeHandler
        .connect(owner)
        .setExerciseFee(ethers.parseEther("0.001"));

      // Approve settlement token for borrowing and fees
      const borrowAmount = ethers.parseEther("10");
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));

      // Get initial balances
      const initialUser1Balance = await settlementToken.balanceOf(
        user1.address
      );
      const initialFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Borrow
      await router
        .connect(user1)
        .borrow(escrowAddress, user1.address, borrowAmount);

      // Get final balances
      const finalUser1Balance = await settlementToken.balanceOf(user1.address);
      const finalFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Calculate expected fees
      const expectedBorrowFee =
        (borrowAmount * refSpot * ethers.parseEther("0.001")) /
        (BASE * auctionInitialization.notional);

      // Check balances
      expect(finalUser1Balance).to.be.lt(initialUser1Balance);
      expect(finalFeeHandlerBalance).to.equal(
        initialFeeHandlerBalance + expectedBorrowFee
      );
    });
  });

  describe("Fees in RFQ", function () {
    it("should apply correct fees when taking a quote", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6), // 2% premium
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

      // Get initial balances
      const initialOwnerBalance = await underlyingToken.balanceOf(
        owner.address
      );
      const initialUser1Balance = await settlementToken.balanceOf(
        user1.address
      );
      const initialFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Take the quote
      await router
        .connect(owner)
        .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress);

      // Get final balances
      const finalOwnerBalance = await underlyingToken.balanceOf(owner.address);
      const finalUser1Balance = await settlementToken.balanceOf(user1.address);
      const finalFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Calculate expected fees
      const expectedMatchFee =
        (rfqInitialization.rfqQuote.premium * ethers.parseEther("0.01")) / BASE;

      // Check balances
      expect(finalOwnerBalance).to.be.lt(initialOwnerBalance);
      expect(finalUser1Balance).to.be.lt(initialUser1Balance);
      expect(finalFeeHandlerBalance).to.equal(
        initialFeeHandlerBalance + expectedMatchFee
      );
    });

    it("should apply correct fees when taking a quote with a distribution partner", async function () {
      // Set up a distribution partner
      await feeHandler
        .connect(owner)
        .setDistPartnerFeeShares([user2.address], [ethers.parseEther("0.05")]);

      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6), // 2% premium
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

      // Get initial balances
      const initialOwnerBalance = await underlyingToken.balanceOf(
        owner.address
      );
      const initialUser1Balance = await settlementToken.balanceOf(
        user1.address
      );
      const initialFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );
      const initialDistPartnerBalance = await settlementToken.balanceOf(
        user2.address
      );

      // Take the quote
      await router
        .connect(owner)
        .takeQuote(owner.address, rfqInitialization, user2.address);

      // Get final balances
      const finalOwnerBalance = await underlyingToken.balanceOf(owner.address);
      const finalUser1Balance = await settlementToken.balanceOf(user1.address);
      const finalFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );
      const finalDistPartnerBalance = await settlementToken.balanceOf(
        user2.address
      );

      // Calculate expected fees
      const expectedMatchFee =
        (rfqInitialization.rfqQuote.premium * ethers.parseEther("0.01")) / BASE;
      const expectedDistPartnerFee =
        (expectedMatchFee * ethers.parseEther("0.05")) / BASE;
      const expectedProtocolFee = expectedMatchFee - expectedDistPartnerFee;

      // Check balances
      expect(finalOwnerBalance).to.be.lt(initialOwnerBalance);
      expect(finalUser1Balance).to.be.lt(initialUser1Balance);
      expect(finalFeeHandlerBalance).to.equal(
        initialFeeHandlerBalance + expectedProtocolFee
      );
      expect(finalDistPartnerBalance).to.equal(
        initialDistPartnerBalance + expectedDistPartnerFee
      );
    });

    it("should revert when attempting to reuse the same quote hash", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6), // 2% premium
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

      // Take the quote for the first time
      await router
        .connect(owner)
        .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress);

      // Attempt to take the same quote again
      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");
    });

    it("should revert when the quoter has insufficient balance", async function () {
      const [, , , poorQuoter] = await ethers.getSigners(); // New signer with no balance

      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6), // 2% premium
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await poorQuoter.signMessage(
        ethers.getBytes(payloadHash)
      );
      rfqInitialization.rfqQuote.signature = signature;

      // Approve tokens for quoter
      await settlementToken
        .connect(poorQuoter)
        .approve(router.target, ethers.MaxUint256);

      // Approve tokens for user1
      await underlyingToken
        .connect(user1)
        .approve(router.target, ethers.MaxUint256);

      // Attempt to take the quote, should revert due to insufficient balance
      await expect(
        router
          .connect(user1)
          .takeQuote(user1.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe("Exercise Fees", function () {
    it("should apply correct fees when exercising a call option", async function () {
      await feeHandler
        .connect(owner)
        .setExerciseFee(ethers.parseEther("0.001"));
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        borrowCap: ethers.parseEther("1"),
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
        .bidOnAuction(
          escrowAddress,
          user1.address,
          relBid,
          refSpot,
          data,
          ethers.ZeroAddress
        );

      // Fast forward time to after earliest exercise tenor
      await ethers.provider.send("evm_increaseTime", [86400 * 7]);
      await ethers.provider.send("evm_mine", []);

      // Approve settlement token for exercise and fees
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));

      // Get initial balances
      const initialOwnerUnderlyingBalance = await underlyingToken.balanceOf(
        owner.address
      );
      const initialOwnerSettlementBalance = await settlementToken.balanceOf(
        owner.address
      );
      const initialUser1Balance = await settlementToken.balanceOf(
        user1.address
      );
      const initialFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Exercise the call
      await router.connect(user1).exercise(
        escrowAddress,
        user1.address,
        ethers.parseEther("50"), // Exercising half the notional
        true, // Pay in settlement token
        []
      );

      // Get final balances
      const finalOwnerUnderlyingBalance = await underlyingToken.balanceOf(
        owner.address
      );
      const finalUser1Balance = await settlementToken.balanceOf(user1.address);
      const finalOwnerSettlementBalance = await settlementToken.balanceOf(
        owner.address
      );
      const finalFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Calculate expected fees
      const exerciseAmount = (ethers.parseEther("50") * refSpot) / BASE;
      const expectedExerciseFee =
        (exerciseAmount * ethers.parseEther("0.001")) / BASE;

      // Check balances
      expect(finalOwnerUnderlyingBalance).to.be.equal(
        initialOwnerUnderlyingBalance
      );
      expect(finalOwnerSettlementBalance).to.be.equal(
        initialOwnerSettlementBalance + exerciseAmount
      );
      expect(finalUser1Balance).to.be.equal(
        initialUser1Balance - exerciseAmount - expectedExerciseFee
      );
      expect(finalFeeHandlerBalance).to.equal(
        initialFeeHandlerBalance + expectedExerciseFee
      );
    });
    it("should apply correct fees when exercising with underlying token", async function () {
      await feeHandler
        .connect(owner)
        .setExerciseFee(ethers.parseEther("0.001"));
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        borrowCap: ethers.parseEther("1"),
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
        .bidOnAuction(
          escrowAddress,
          user1.address,
          relBid,
          refSpot,
          data,
          ethers.ZeroAddress
        );

      // Fast forward time to after earliest exercise tenor
      await ethers.provider.send("evm_increaseTime", [86400 * 7]);
      await ethers.provider.send("evm_mine", []);

      // Approve underlying token for exercise and fees
      await underlyingToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));

      // Get initial balances
      const initialOwnerUnderlyingBalance = await underlyingToken.balanceOf(
        owner.address
      );
      const initialUser1Balance = await underlyingToken.balanceOf(
        user1.address
      );
      const initialFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Exercise the call
      await router.connect(user1).exercise(
        escrowAddress,
        user1.address,
        ethers.parseEther("50"), // Exercising half the notional
        false, // Pay in underlying token
        []
      );

      // Get final balances
      const finalOwnerUnderlyingBalance = await underlyingToken.balanceOf(
        owner.address
      );
      const finalUser1Balance = await underlyingToken.balanceOf(user1.address);
      const finalFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Calculate expected fees
      const oraclePrice = await mockOracle.getPrice(
        underlyingToken.target,
        settlementToken.target,
        []
      );
      const exerciseAmount = ethers.parseEther("50");
      const expectedExerciseFee =
        (exerciseAmount * ethers.parseEther("0.001") * oraclePrice) /
        (BASE * BASE);

      // Check balances
      expect(finalOwnerUnderlyingBalance).to.be.gt(
        initialOwnerUnderlyingBalance
      );
      expect(finalUser1Balance).to.be.equal(initialUser1Balance);
      expect(finalFeeHandlerBalance).to.be.equal(
        initialFeeHandlerBalance + expectedExerciseFee
      );
    });
  });

  describe("Fee Limits", function () {
    it("should respect maximum fee limits", async function () {
      // Set fees to maximum allowed values
      await feeHandler.connect(owner).setMatchFee(MAX_MATCH_FEE);
      await feeHandler.connect(owner).setExerciseFee(MAX_EXERCISE_FEE);

      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        relPremiumStart: ethers.parseEther("0.01"),
        oracleAddress: String(mockOracle.target),
      });

      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Bid on auction
      const bidAmount = ethers.parseEther("20"); // 20% of notional
      await settlementToken
        .connect(user1)
        .approve(router.target, bidAmount * 2n); // Approve extra for fees
      const relBid = ethers.parseEther("0.2");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      const initialFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      await router
        .connect(user1)
        .bidOnAuction(
          escrowAddress,
          user1.address,
          relBid,
          refSpot,
          data,
          ethers.ZeroAddress
        );

      const finalFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Check that the fee doesn't exceed the maximum
      const actualFee = finalFeeHandlerBalance - initialFeeHandlerBalance;
      const maxPossibleFee = (bidAmount * MAX_MATCH_FEE) / BASE;
      expect(actualFee).to.be.lte(maxPossibleFee);

      // Exercise the option
      await ethers.provider.send("evm_increaseTime", [86400 * 7]);
      await ethers.provider.send("evm_mine", []);

      const exerciseAmount = ethers.parseEther("50");
      await settlementToken
        .connect(user1)
        .approve(router.target, exerciseAmount * 2n); // Approve extra for fees

      const exerciseInitialFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      await router.connect(user1).exercise(
        escrowAddress,
        user1.address,
        exerciseAmount,
        true, // Pay in settlement token
        []
      );

      const exerciseFinalFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );

      // Check that the exercise fee doesn't exceed the maximum
      const actualExerciseFee =
        exerciseFinalFeeHandlerBalance - exerciseInitialFeeHandlerBalance;
      const maxPossibleExerciseFee = (exerciseAmount * MAX_EXERCISE_FEE) / BASE;
      expect(actualExerciseFee).to.be.lte(maxPossibleExerciseFee);
    });

    it("should revert when trying to set fees above maximum limits", async function () {
      await expect(
        feeHandler.connect(owner).setMatchFee(MAX_MATCH_FEE + 1n)
      ).to.be.revertedWithCustomError(feeHandler, "InvalidMatchFee");

      await expect(
        feeHandler.connect(owner).setExerciseFee(MAX_EXERCISE_FEE + 1n)
      ).to.be.revertedWithCustomError(feeHandler, "InvalidExerciseFee");
    });

    it("should handle fee distribution to distribution partners correctly", async function () {
      // Set fees and distribution partner
      const matchFee = ethers.parseEther("0.01"); // 1%
      const distPartnerShare = ethers.parseEther("0.05"); // 5%
      await feeHandler.connect(owner).setMatchFee(matchFee);
      await feeHandler
        .connect(owner)
        .setDistPartnerFeeShares([user2.address], [ethers.parseEther("0.05")]);

      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        relPremiumStart: ethers.parseEther("0.01"),
        oracleAddress: String(mockOracle.target),
      });

      const escrow = await createAuction(auctionInitialization, router, owner);
      const escrowAddress = escrow.target;

      // Bid on auction
      const bidAmount = ethers.parseEther("10");
      await settlementToken
        .connect(user1)
        .approve(router.target, bidAmount * 2n);
      const relBid = ethers.parseEther("0.1");
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      const initialFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );
      const initialDistPartnerBalance = await settlementToken.balanceOf(
        user2.address
      );

      await router.connect(user1).bidOnAuction(
        escrowAddress,
        user1.address,
        relBid,
        refSpot,
        data,
        user2.address // Use distribution partner
      );

      const finalFeeHandlerBalance = await settlementToken.balanceOf(
        feeHandler.target
      );
      const finalDistPartnerBalance = await settlementToken.balanceOf(
        user2.address
      );

      // Check fee distribution
      const totalFee =
        (auctionInitialization.auctionParams.relPremiumStart *
          refSpot *
          ethers.parseEther("0.01") *
          auctionInitialization.notional) /
        (BASE * BASE * BASE);
      const expectedDistPartnerFee = (totalFee * distPartnerShare) / BASE;
      const expectedProtocolFee = totalFee - expectedDistPartnerFee;

      expect(finalFeeHandlerBalance - initialFeeHandlerBalance).to.equal(
        expectedProtocolFee
      );
      expect(finalDistPartnerBalance - initialDistPartnerBalance).to.equal(
        expectedDistPartnerFee
      );
    });
  });

  describe("Fee Capping", function () {
    it("should cap fees at maximum allowed values when using a high fee handler", async function () {
      const HighFeeHandler =
        await ethers.getContractFactory("MockHighFeeHandler");
      const highFeeHandler = await HighFeeHandler.deploy(
        owner.address,
        router.target,
        ethers.parseEther("0.5"), // 50% match fee
        ethers.parseEther("0.5") // 50% exercise fee
      );

      // Set the high fee handler
      await router.connect(owner).setFeeHandler(highFeeHandler.target);

      // Check exercise fee
      const exerciseFee = await router.getExerciseFee();
      expect(exerciseFee).to.equal(ethers.parseEther("0.005")); // Max exercise fee is 0.5%

      await highFeeHandler.setDistPartnerFeeShares(
        [user1.address],
        [ethers.parseEther("0.05")]
      );

      // Check match fees
      const optionPremium = ethers.parseEther("100"); // Example premium
      const [matchFeeProtocol, matchFeeDistPartner] = await router.getMatchFees(
        user1.address,
        optionPremium
      );

      // Max match fee is 20%
      const expectedMaxMatchFee = (optionPremium * BigInt(20)) / BigInt(100);
      expect(matchFeeProtocol + matchFeeDistPartner).to.equal(
        expectedMaxMatchFee
      );

      // Verify distribution partner share
      const expectedDistPartnerFee =
        (expectedMaxMatchFee * BigInt(5)) / BigInt(100); // 5% of max match fee
      expect(matchFeeDistPartner).to.equal(expectedDistPartnerFee);
      expect(matchFeeProtocol).to.equal(
        expectedMaxMatchFee - expectedDistPartnerFee
      );

      // set dist partner fee over Base
      await highFeeHandler.setDistPartnerFeeShares(
        [user1.address],
        [ethers.parseEther("1.5")]
      );
      const [secondMatchFeeProtocol, secondMatchFeeDistPartner] =
        await router.getMatchFees(user1.address, optionPremium);
      expect(secondMatchFeeDistPartner).to.equal(expectedMaxMatchFee);
      expect(secondMatchFeeProtocol).to.equal(0n);
    });
  });

  describe("Quote Pausing", function () {
    it("should allow toggling pause on/off and revert when taking a quote while paused", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        premium: ethers.parseUnits("2", 6), // 2% premium
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

      // quoter pauses quotes
      await expect(router.connect(user1).togglePauseQuotes())
        .to.emit(router, "PauseQuotes")
        .withArgs(user1.address, true);

      // Attempt to take quote while paused
      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");

      // Toggle pause off
      await expect(router.connect(user1).togglePauseQuotes())
        .to.emit(router, "PauseQuotes")
        .withArgs(user1.address, false);

      // Take quote should now succeed
      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.emit(router, "TakeQuote");
    });
  });

  describe("Revert Scenarios", function () {
    it("Should revert setMatchFeeInfo when matchFee exceeds MAX_MATCH_FEE", async function () {
      const excessiveMatchFee = MAX_MATCH_FEE + ethers.parseEther("0.001");

      await expect(
        feeHandler.connect(owner).setMatchFee(excessiveMatchFee)
      ).to.be.revertedWithCustomError(feeHandler, "InvalidMatchFee");
    });

    it("Should revert setMatchFeeInfo when distPartnerFeeShare exceeds BASE", async function () {
      const excessiveDistPartnerFeeShare = BASE + ethers.parseEther("0.001");

      await expect(
        feeHandler
          .connect(owner)
          .setDistPartnerFeeShares(
            [user1.address],
            [excessiveDistPartnerFeeShare]
          )
      ).to.be.revertedWithCustomError(feeHandler, "InvalidDistPartnerFeeShare");
    });

    it("Should revert setExerciseFee when exerciseFee exceeds MAX_EXERCISE_FEE", async function () {
      const excessiveExerciseFee =
        MAX_EXERCISE_FEE + ethers.parseEther("0.001");

      await expect(
        feeHandler.connect(owner).setExerciseFee(excessiveExerciseFee)
      ).to.be.revertedWithCustomError(feeHandler, "InvalidExerciseFee");
    });

    it("Should revert setDistPartners with unequal array lengths", async function () {
      const accounts = [user1.address, user2.address];
      const feeShares = [BASE]; // Unequal length

      await expect(
        feeHandler.connect(owner).setDistPartnerFeeShares(accounts, feeShares)
      ).to.be.revertedWithCustomError(feeHandler, "InvalidArrayLength");
    });

    it("Should revert setDistPartners with zero-length arrays", async function () {
      const accounts: string[] = [];
      const feeShares: bigint[] = [];

      await expect(
        feeHandler.connect(owner).setDistPartnerFeeShares(accounts, feeShares)
      ).to.be.revertedWithCustomError(feeHandler, "InvalidArrayLength");
    });

    it("Should revert setDistPartners when setting a distPartner to the same value", async function () {
      const accounts = [user1.address];
      const feeShares = [BASE];

      // First set to true
      await feeHandler
        .connect(owner)
        .setDistPartnerFeeShares(accounts, feeShares);

      // Attempt to set to true again
      await expect(
        feeHandler.connect(owner).setDistPartnerFeeShares(accounts, feeShares)
      ).to.be.revertedWithCustomError(feeHandler, "DistPartnerFeeAlreadySet");
    });
  });

  describe("Extra Cases", function () {
    it("Should correctly handle getMatchFeeInfo for dist and non-dist partners", async function () {
      // Initially, user1 is not a distPartner
      let info = await feeHandler.getMatchFeeInfo(user1.address);
      expect(info._matchFee).to.equal(ethers.parseEther("0.01"));
      expect(info._matchFeeDistPartnerShare).to.equal(0);

      // Set user1 as a distPartner
      await feeHandler
        .connect(owner)
        .setDistPartnerFeeShares([user1.address], [ethers.parseEther("0.05")]);

      // Now, user1 should have a distPartner share
      info = await feeHandler.getMatchFeeInfo(user1.address);
      expect(info._matchFee).to.equal(ethers.parseEther("0.01"));
      expect(info._matchFeeDistPartnerShare).to.equal(
        ethers.parseEther("0.05")
      );
    });
  });
});
