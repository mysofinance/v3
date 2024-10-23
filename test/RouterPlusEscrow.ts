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
  setupAuction,
  rfqSignaturePayload,
  getRFQInitialization,
  deployEscrowWithRFQ,
  getAuctionInitialization,
} from "./testHelpers";

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
      const { auctionInitialization } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

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

      // Approve and start auction
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
      const data: any[] = [];

      await expect(
        router
          .connect(user1)
          .bidOnAuction(
            escrowAddress,
            user1.address,
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
          0,
          0,
          ethers.ZeroAddress
        );
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

      // Approve and start auction
      await underlyingToken
        .connect(owner)
        .approve(router.target, auctionInitialization.notional);
      await router
        .connect(owner)
        .createAuction(owner.address, auctionInitialization);

      const escrows = await router.getEscrows(0, 1);
      const escrowAddress = escrows[0];
      const escrow: any = await escrowImpl.attach(escrowAddress);

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
          .bidOnAuction(
            escrowAddress,
            user1.address,
            lowRelBid,
            refSpot,
            data,
            ethers.ZeroAddress
          )
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

    it("should revert if quote is expired", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        validUntil: (await provider.getBlock("latest")).timestamp - 1,
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

      // Attempt to take the expired quote
      await expect(
        router
          .connect(owner)
          .takeQuote(owner.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.reverted;
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

      // Approve and start auction
      await underlyingToken
        .connect(owner)
        .approve(router.target, auctionInitialization.notional);
      await router
        .connect(owner)
        .createAuction(owner.address, auctionInitialization);

      const escrows = await router.getEscrows(0, 1);
      const escrowAddress = escrows[0];
      const escrow: any = await escrowImpl.attach(escrowAddress);

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

      // Approve and start auction
      await underlyingToken
        .connect(owner)
        .approve(router.target, auctionInitialization.notional);
      await router
        .connect(owner)
        .createAuction(owner.address, auctionInitialization);

      const escrows = await router.getEscrows(0, 1);
      const escrowAddress = escrows[0];
      const escrow: any = await escrowImpl.attach(escrowAddress);

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

      // Approve and start auction
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

      // Approve and start auction
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
    it("should allow borrowing and repaying", async function () {
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

      // Approve and start auction
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

      // Borrow underlying tokens
      await expect(
        router
          .connect(user1)
          .borrow(escrowAddress, user1.address, ethers.parseEther("10"))
      ).to.emit(router, "Borrow");

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

      // Approve and start auction
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

      // Attempt to borrow when borrowing is disallowed
      await expect(
        router
          .connect(user1)
          .borrow(escrowAddress, user1.address, ethers.parseEther("10"))
      ).to.be.reverted;
    });

    it("should allow withdrawing from expired auction and creating a new one", async function () {
      const { auctionInitialization } = await setupAuction(
        {
          underlyingTokenAddress: String(underlyingToken.target),
          settlementTokenAddress: String(settlementToken.target),
          oracleAddress: String(mockOracle.target),
          router,
          owner,
        },
        false
      );

      // Approve and start first auction
      await underlyingToken
        .connect(owner)
        .approve(router.target, auctionInitialization.notional * 2n);
      await router
        .connect(owner)
        .createAuction(owner.address, auctionInitialization);

      const escrows = await router.getEscrows(0, 1);
      const oldEscrowAddress = escrows[0];

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
            auctionInitialization
          )
      ).to.be.reverted;

      // Revert if not owner
      await expect(
        router
          .connect(user1)
          .withdrawFromEscrowAndCreateAuction(
            oldEscrowAddress,
            owner.address,
            auctionInitialization
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
            auctionInitialization
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
          .bidOnAuction(
            newEscrowAddress,
            user1.address,
            relBid,
            refSpot,
            data,
            ethers.ZeroAddress
          )
      ).to.emit(router, "BidOnAuction");
    });
  });

  describe("Delegation", function () {
    it("should allow on-chain voting delegation", async function () {
      const { auctionInitialization } = await setupAuction({
        underlyingTokenAddress: String(votingUnderlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        relPremiumStart: ethers.parseEther("0.01"),
        oracleAddress: String(mockOracle.target),
        votingDelegationAllowed: true,
        router,
        owner,
      });

      // Approve and start auction
      await votingUnderlyingToken
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

      // Delegate voting
      const delegate = user2.address;
      await expect(escrow.connect(owner).handleOnChainVoting(delegate))
        .to.emit(escrow, "OnChainVotingDelegation")
        .withArgs(delegate);
    });

    it("should revert if delegation is not allowed", async function () {
      const { auctionInitialization } = await setupAuction({
        underlyingTokenAddress: String(votingUnderlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        relPremiumStart: ethers.parseEther("0.01"),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      // Approve and start auction
      await votingUnderlyingToken
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

      // Attempt to delegate voting when not allowed
      const delegate = user2.address;
      await expect(escrow.connect(user1).handleOnChainVoting(delegate)).to.be
        .reverted;
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
      const { escrow, auctionInitialization } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      await expect(
        escrow.initializeAuction(
          router.target,
          owner.address,
          0,
          auctionInitialization,
          1
        )
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidInitialization");
    });

    it("should revert with InvalidTokenPair", async function () {
      const { auctionInitialization } = await setupAuction(
        {
          underlyingTokenAddress: String(underlyingToken.target),
          settlementTokenAddress: String(underlyingToken.target), // Same as underlying
          oracleAddress: String(mockOracle.target),
          router,
          owner,
        },
        false
      );

      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization)
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidTokenPair");
    });

    it("should revert with InvalidNotional", async function () {
      const { auctionInitialization } = await setupAuction(
        {
          underlyingTokenAddress: String(underlyingToken.target),
          settlementTokenAddress: String(settlementToken.target),
          oracleAddress: String(mockOracle.target),
          router,
          owner,
          notionalAmount: 0n,
        },
        false
      );

      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization)
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidNotional");
    });

    it("should revert with InvalidStrike", async function () {
      const { auctionInitialization } = await setupAuction(
        {
          underlyingTokenAddress: String(underlyingToken.target),
          settlementTokenAddress: String(settlementToken.target),
          oracleAddress: String(mockOracle.target),
          router,
          owner,
          relStrike: 0n,
        },
        false
      );

      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization)
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidStrike");
    });

    it("should revert with InvalidTenor", async function () {
      const { auctionInitialization } = await setupAuction(
        {
          underlyingTokenAddress: String(underlyingToken.target),
          settlementTokenAddress: String(settlementToken.target),
          oracleAddress: String(mockOracle.target),
          router,
          owner,
          tenor: 0,
        },
        false
      );

      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization)
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidTenor");
    });

    it("should revert with InvalidEarliestExerciseTenor", async function () {
      const { auctionInitialization } = await setupAuction(
        {
          underlyingTokenAddress: String(underlyingToken.target),
          settlementTokenAddress: String(settlementToken.target),
          oracleAddress: String(mockOracle.target),
          router,
          owner,
          tenor: 86400, // 1 day
          earliestExerciseTenor: 86400, // 1 day (should be less than tenor - 1 day)
        },
        false
      );

      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization)
      ).to.be.revertedWithCustomError(
        escrowImpl,
        "InvalidEarliestExerciseTenor"
      );
    });

    it("should revert with InvalidRelPremiums", async function () {
      const { auctionInitialization } = await setupAuction(
        {
          underlyingTokenAddress: String(underlyingToken.target),
          settlementTokenAddress: String(settlementToken.target),
          oracleAddress: String(mockOracle.target),
          router,
          owner,
          relPremiumStart: 0n,
          relPremiumFloor: 0n,
        },
        false
      );

      // rel premium start == 0
      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization)
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidRelPremiums");

      // rel premium floor == 0
      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, {
            ...auctionInitialization,
            auctionParams: {
              ...auctionInitialization.auctionParams,
              relPremiumStart: 1n,
            },
          })
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidRelPremiums");

      // rel premium floor > start premium
      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, {
            ...auctionInitialization,
            auctionParams: {
              ...auctionInitialization.auctionParams,
              relPremiumStart: 1n,
              relPremiumFloor: 2n,
            },
          })
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidRelPremiums");
    });

    it("should revert with InvalidMinMaxSpot", async function () {
      const { auctionInitialization } = await setupAuction(
        {
          underlyingTokenAddress: String(underlyingToken.target),
          settlementTokenAddress: String(settlementToken.target),
          oracleAddress: String(mockOracle.target),
          router,
          owner,
          minSpot: 2n,
          maxSpot: 1n,
        },
        false
      );

      // min spot > max spot
      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization)
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidMinMaxSpot");

      // max spot = 0
      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, {
            ...auctionInitialization,
            auctionParams: {
              ...auctionInitialization.auctionParams,
              maxSpot: 0n,
              minSpot: 0n,
            },
          })
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidMinMaxSpot");
    });

    it("should revert with InvalidOracle", async function () {
      const { auctionInitialization } = await setupAuction(
        {
          underlyingTokenAddress: String(underlyingToken.target),
          settlementTokenAddress: String(settlementToken.target),
          oracleAddress: ethers.ZeroAddress,
          router,
          owner,
        },
        false
      );

      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization)
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidOracle");
    });

    it("should revert with InvalidBorrowCap", async function () {
      const { auctionInitialization } = await setupAuction(
        {
          underlyingTokenAddress: String(underlyingToken.target),
          settlementTokenAddress: String(settlementToken.target),
          oracleAddress: String(mockOracle.target),
          router,
          owner,
          borrowCap: ethers.parseEther("1.1"), // 110%, which is > BASE (100%)
        },
        false
      );

      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization)
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidBorrowCap");
    });

    it("should revert when bidding with invalid parameters", async function () {
      const { escrow, auctionInitialization } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      // Attempt to bid with invalid parameters (e.g., zero relBid)
      await expect(
        router.connect(user1).bidOnAuction(
          escrow.target,
          user1.address,
          0, // Invalid relBid
          ethers.parseUnits("1", 6),
          [],
          ethers.ZeroAddress
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

    it("should revert with InvalidTokenPair", async function () {
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
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidTokenPair");
    });

    it("should revert with InvalidNotional", async function () {
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
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidNotional");
    });

    it("should revert with InvalidStrike", async function () {
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
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidStrike");
    });

    it("should revert with InvalidEarliestExerciseTenor (expiry past)", async function () {
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
      ).to.be.revertedWithCustomError(
        escrowImpl,
        "InvalidEarliestExerciseTenor"
      );
    });

    it("should revert with InvalidEarliestExerciseTenor (earliest exercise too close to expiry)", async function () {
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
      ).to.be.revertedWithCustomError(
        escrowImpl,
        "InvalidEarliestExerciseTenor"
      );
    });

    it("should revert with InvalidBorrowCap", async function () {
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
      ).to.be.revertedWithCustomError(escrowImpl, "InvalidBorrowCap");
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
      const {
        escrow: escrowSetup,
        auctionInitialization: auctionInitializationSetup,
      } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });
      escrow = escrowSetup;
      auctionInitialization = auctionInitializationSetup;
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
              [],
              ethers.ZeroAddress
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
            [],
            ethers.ZeroAddress
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
            [],
            ethers.ZeroAddress
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
            [],
            ethers.ZeroAddress
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
      const {
        escrow: escrowSetup,
        auctionInitialization: auctionInitializationSetup,
      } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
        borrowCap: ethers.parseEther("0.5"), // 50% borrow cap
      });
      escrow = escrowSetup;
      auctionInitialization = auctionInitializationSetup;

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
          [],
          ethers.ZeroAddress
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
      const { escrow: newEscrow } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

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
      const {
        escrow: escrowSetup,
        auctionInitialization: auctionInitializationSetup,
      } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
        borrowCap: ethers.parseEther("0.5"), // 50% borrow cap
      });
      escrow = escrowSetup;
      auctionInitialization = auctionInitializationSetup;

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
          [],
          ethers.ZeroAddress
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
      const { escrow: newEscrow } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      await expect(
        router
          .connect(user1)
          .repay(newEscrow.target, user1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(newEscrow, "NoOptionMinted");
    });

    it("should revert with InvalidRepayTime if repaid after expiry", async function () {
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
      const { escrow: newEscrow, auctionInitialization } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
        borrowCap: 0n, // Set borrow cap to 0
      });

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
          [],
          ethers.ZeroAddress
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

  describe("Edge Cases and Reverts", function () {
    it("should push new escrow to array when creating second identical auction", async function () {
      const { auctionInitialization } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        notionalAmount: ethers.parseEther("100") / 2n,
        relStrike: ethers.parseEther("1"),
        relPremiumStart: ethers.parseEther("0.01"),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      // Approve and start first auction
      await underlyingToken
        .connect(owner)
        .approve(router.target, auctionInitialization.notional * 2n);
      await router
        .connect(owner)
        .createAuction(owner.address, auctionInitialization);

      // Attempt to start another auction with the same nonce (should create a new escrow)
      await expect(
        router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization)
      ).to.emit(router, "CreateAuction");

      // Fetch both escrows and ensure they are unique
      const escrows = await router.getEscrows(0, 2);
      expect(escrows[0]).to.not.equal(escrows[1]);
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
      ).to.be.reverted;
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
            [],
            ethers.ZeroAddress
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
      const { auctionInitialization } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        relStrike: ethers.parseEther("1"),
        relPremiumStart: ethers.parseEther("0.01"),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      // Create a few more escrows
      for (let i = 0; i < 3; i++) {
        await underlyingToken
          .connect(owner)
          .approve(router.target, auctionInitialization.notional);
        await router
          .connect(owner)
          .createAuction(owner.address, auctionInitialization);
      }

      const numEscrows = await router.numEscrows();
      expect(numEscrows).to.equal(4);

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

/*
async function deployEscrow(auctionInitialization: DataTypes.AuctionInitialization) {
      const tx = await router.connect(owner).createAuction(owner.address, auctionInitialization);
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (e: any) => e.fragment.name === "CreateAuction"
      );
      return Escrow.attach(event?.args.escrow);
    }
      */
