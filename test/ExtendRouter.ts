const { expect } = require("chai");
import { ethers } from "hardhat";
import {
  Router,
  Escrow,
  MockERC20,
  MockERC20Votes,
  MockOracle,
} from "../typechain-types";
import {
  setupTestContracts,
  setupAuction,
  rfqSignaturePayload,
  getRFQInitialization,
} from "./testHelpers";

describe("Router Contract Ext", function () {
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
      const { escrow } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        relPremiumStart: ethers.parseEther("0.02"),
        router,
        owner,
      });

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
            escrow.target,
            user1.address,
            relBid,
            refSpot,
            data,
            ethers.ZeroAddress
          )
      )
        .to.emit(router, "BidOnAuction")
        .withArgs(escrow.target, relBid, user1.address, refSpot, 0, 0);
    });

    it("should revert if bidding with insufficient premium", async function () {
      const { escrow } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

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
            escrow.target,
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
        underlyingToken: String(underlyingToken.target),
        settlementToken: String(settlementToken.target),
        oracle: String(mockOracle.target),
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await owner.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      // Approve tokens
      await settlementToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));

      // Take the quote
      await expect(
        router
          .connect(user1)
          .takeQuote(user1.address, rfqInitialization, ethers.ZeroAddress)
      ).to.emit(router, "TakeQuote");
    });

    it("should revert if quote is expired", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingToken: String(underlyingToken.target),
        settlementToken: String(settlementToken.target),
        oracle: String(mockOracle.target),
        rfqQuote: {
          premium: ethers.parseEther("10"),
          validUntil: (await provider.getBlock("latest")).timestamp - 10, // Already expired
          signature: ethers.ZeroHash,
        },
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await owner.signMessage(ethers.getBytes(payloadHash));
      rfqInitialization.rfqQuote.signature = signature;

      // Approve tokens
      await settlementToken
        .connect(owner)
        .approve(router.target, ethers.parseEther("1000000"));
      await underlyingToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));

      // Attempt to take the expired quote
      await expect(
        router
          .connect(user1)
          .takeQuote(user1.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe("Withdraw", function () {
    it("should allow owner to withdraw", async function () {
      const { escrow } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      // Withdraw funds
      await expect(
        router
          .connect(owner)
          .withdraw(
            escrow.target,
            owner.address,
            underlyingToken.target,
            ethers.parseEther("100")
          )
      ).to.emit(router, "Withdraw");
    });

    it("should revert if non-owner tries to withdraw", async function () {
      const { escrow } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      // Attempt to withdraw as non-owner
      await expect(
        router
          .connect(user1)
          .withdraw(
            escrow.target,
            user1.address,
            underlyingToken.target,
            ethers.parseEther("100")
          )
      ).to.be.reverted;
    });
  });

  describe("Exercise Call", function () {
    it("should allow exercising a call option", async function () {
      const { escrow } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        relPremiumStart: ethers.parseEther("0.02"),
        router,
        owner,
      });

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
          escrow.target,
          user1.address,
          relBid,
          refSpot,
          data,
          ethers.ZeroAddress
        );

      // Fast forward time to after earliest exercise tenor
      const optionInfo = await escrow.optionInfo();
      const earliestExercise = optionInfo.earliestExercise;
      const block = await ethers.provider.getBlock("latest");
      const blockTimestamp = block?.timestamp || new Date().getTime() / 1000;
      const moveForwardTime = Number(earliestExercise) - blockTimestamp + 1;
      await ethers.provider.send("evm_increaseTime", [moveForwardTime]);
      await ethers.provider.send("evm_mine", []);

      // Approve settlement token for exercise
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("10"));

      // Exercise the call
      await expect(
        router.connect(user1).exercise(
          escrow.target,
          user1.address,
          ethers.parseEther("50"), // Exercising half the notional
          true, // Pay in settlement token
          []
        )
      ).to.emit(router, "Exercise");
    });

    it("should revert if exercising before earliest exercise tenor", async function () {
      const { escrow } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = await escrow.currAsk();
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
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
          escrow.target,
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
      const { escrow } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        borrowCap: ethers.parseUnits("1", 18),
        router,
        owner,
      });

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = await escrow.currAsk();
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
          user1.address,
          relBid,
          refSpot,
          data,
          ethers.ZeroAddress
        );

      // Fast forward time to after earliest exercise tenor
      const optionInfo = await escrow.optionInfo();
      const earliestExercise = optionInfo.earliestExercise;
      const block = await ethers.provider.getBlock("latest");
      const blockTimestamp = block?.timestamp || new Date().getTime() / 1000;
      const moveForwardTime = Number(earliestExercise) - blockTimestamp + 1;
      await ethers.provider.send("evm_increaseTime", [moveForwardTime]);
      await ethers.provider.send("evm_mine", []);

      // Borrow underlying tokens
      await expect(
        router
          .connect(user1)
          .borrow(escrow.target, user1.address, ethers.parseEther("10"))
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
          .repay(escrow.target, user1.address, ethers.parseEther("10"))
      ).to.emit(router, "Repay");

      // Check borrowed amount after repayment
      expect(await escrow.borrowedUnderlyingAmounts(user1.address)).to.equal(
        ethers.parseEther("0")
      );
    });

    it("should revert if borrowing is not allowed", async function () {
      const { escrow } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = await escrow.currAsk();
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
          user1.address,
          relBid,
          refSpot,
          data,
          ethers.ZeroAddress
        );

      // Fast forward time to after earliest exercise tenor
      const optionInfo = await escrow.optionInfo();
      const earliestExercise = optionInfo.earliestExercise;
      const block = await ethers.provider.getBlock("latest");
      const blockTimestamp = block?.timestamp || new Date().getTime() / 1000;
      const moveForwardTime = Number(earliestExercise) - blockTimestamp + 1;
      await ethers.provider.send("evm_increaseTime", [moveForwardTime]);
      await ethers.provider.send("evm_mine", []);

      // Attempt to borrow when borrowing is disallowed
      await expect(
        router
          .connect(user1)
          .borrow(escrow.target, user1.address, ethers.parseEther("10"))
      ).to.be.reverted;
    });

    it("should allow withdrawing and creating a new one", async function () {
      const { escrow, auctionInitialization } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      const oldEscrowAddress = escrow.target;

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

      // Re-approve router
      await underlyingToken
        .connect(owner)
        .approve(router.target, auctionInitialization.notional);

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
      const relBid = await newEscrow.currAsk();
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
      const { escrow } = await setupAuction({
        underlyingTokenAddress: String(votingUnderlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        votingDelegationAllowed: true,
        router,
        owner,
      });

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = await escrow.currAsk();
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
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
      const { escrow } = await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      // Approve and bid on auction
      await settlementToken
        .connect(user1)
        .approve(router.target, ethers.parseEther("100"));
      const relBid = await escrow.currAsk();
      const refSpot = ethers.parseUnits("1", 6);
      const data: any[] = [];

      await router
        .connect(user1)
        .bidOnAuction(
          escrow.target,
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

  describe("Edge Cases and Reverts", function () {
    it("should allow creating duplicate escrows without collision", async function () {
      const numEscrowsOld = await router.numEscrows();
      expect(numEscrowsOld).to.be.equal(0);

      await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });
      await setupAuction({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
        router,
        owner,
      });

      const numEscrowsNew = await router.numEscrows();
      expect(numEscrowsNew).to.be.equal(2);

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
      // Create a few escrows
      for (let i = 0; i < 3; i++) {
        await setupAuction({
          underlyingTokenAddress: String(underlyingToken.target),
          settlementTokenAddress: String(settlementToken.target),
          oracleAddress: String(mockOracle.target),
          router,
          owner,
        });
      }
      const numEscrowsNew = await router.numEscrows();
      expect(numEscrowsNew).to.be.equal(3);

      // Case 1: numElements is 0
      await expect(router.getEscrows(0, 0)).to.be.revertedWithCustomError(
        router,
        "InvalidGetEscrowsQuery"
      );

      // Case 2: from + numElements > length
      await expect(router.getEscrows(2, 2)).to.be.revertedWithCustomError(
        router,
        "InvalidGetEscrowsQuery"
      );

      // Verify that a valid query still works
      const validEscrows = await router.getEscrows(0, 3);
      expect(validEscrows.length).to.equal(3);
    });
  });
});
