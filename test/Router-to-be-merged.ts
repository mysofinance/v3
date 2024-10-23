const { expect } = require("chai");
import { ethers } from "hardhat";
import { Router, Escrow, MockERC20, MockOracle } from "../typechain-types";
import {
  setupTestContracts,
  getAuctionInitialization,
  createAuction,
} from "./testHelpers";
import { DataTypes } from "./DataTypes";

describe("Router Contract", function () {
  let router: Router;
  let settlementToken: MockERC20;
  let underlyingToken: MockERC20;
  let mockOracle: MockOracle;
  let owner: any;
  let user1: any;
  let distPartner: string;

  beforeEach(async function () {
    const contracts = await setupTestContracts();
    ({ owner, user1, settlementToken, underlyingToken, router, mockOracle } =
      contracts);
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
        .bidOnAuction(
          escrow.target,
          optionReceiver,
          relBid,
          refSpot,
          data,
          ethers.ZeroAddress
        );

      const preview = await escrow.previewBid(
        relBid,
        refSpot,
        data,
        distPartner
      );
      expect(preview.status).to.equal(
        DataTypes.BidStatus.OptionAlreadyMinted
      );
    });

    it("should revert if the bid is lower than the current ask", async function () {
      // Adjust relBid to be lower than currentAsk
      relBid = currentAsk - 1n;

      const preview = await escrow.previewBid(
        relBid,
        refSpot,
        data,
        distPartner
      );
      expect(preview.status).to.equal(DataTypes.BidStatus.PremiumTooLow);
    });

    it("should revert if reference spot is lower than oracle spot price", async function () {
      // Mock oracle price to be higher than refSpot
      await mockOracle.setPrice(
        underlyingToken.target,
        settlementToken.target,
        ethers.parseUnits("1.5", 6)
      );

      const preview = await escrow.previewBid(
        relBid,
        refSpot,
        data,
        distPartner
      );
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

      const previewBelow = await escrow.previewBid(
        relBid,
        price1,
        data,
        distPartner
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

      const previewAbove = await escrow.previewBid(
        relBid,
        price3,
        data,
        distPartner
      );
      expect(previewAbove.status).to.equal(
        DataTypes.BidStatus.OutOfRangeSpotPrice
      );
    });

    it("should revert if there is insufficient funding", async function () {
      // Mock scenario where the auction contract has insufficient funds
      const bal = await underlyingToken.balanceOf(escrow.target);
      await router
        .connect(owner)
        .withdraw(escrow.target, owner.address, underlyingToken.target, bal);

      const preview = await escrow.previewBid(
        relBid,
        refSpot,
        data,
        distPartner
      );
      expect(preview.status).to.equal(DataTypes.BidStatus.InsufficientFunding);
    });

    it("should revert if protocol fees exceed the premium", async function () {
      const MockFeeHandler =
        await ethers.getContractFactory("MockHighFeeHandler");
      const mockFeeHandler = await MockFeeHandler.deploy(
        owner.address,
        router.target,
        ethers.parseEther("1.1"), // 110% match fee
        ethers.parseEther("1.1"), // 110% distribution partner share
        ethers.parseEther("0")
      );

      // Set new fee handler
      await router.connect(owner).setFeeHandler(mockFeeHandler.target);

      // Set 0x as fee distributor to check fee share cap
      await mockFeeHandler
        .connect(owner)
        .setDistPartners([ethers.ZeroAddress], [true]);

      const preview = await escrow.previewBid(
        relBid,
        refSpot,
        data,
        distPartner
      );
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
});
