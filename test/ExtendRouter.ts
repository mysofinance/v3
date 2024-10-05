const { expect } = require("chai");
import { ethers } from "hardhat";
import {
  Router,
  Escrow,
  MockERC20,
  MockERC20Votes,
  MockOracle,
  DataTypes,
} from "../typechain-types";

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

    const MockERC20Votes = await ethers.getContractFactory("MockERC20Votes");
    votingUnderlyingToken = await MockERC20Votes.deploy(
      "Voting Underlying Token",
      "Voting Underlying Token",
      18
    );

    // Deploy Escrow implementation
    const Escrow = await ethers.getContractFactory("Escrow");
    escrowImpl = await Escrow.deploy();

    // Deploy Router contract
    const Router = await ethers.getContractFactory("Router");
    router = await Router.deploy(owner.address, escrowImpl.target);

    // Deploy mock oracle
    const MockOracle = await ethers.getContractFactory("MockOracle");
    mockOracle = await MockOracle.deploy();
    await mockOracle.setPrice(
      underlyingToken.target,
      settlementToken.target,
      ethers.parseUnits("1", 6)
    );
    await mockOracle.setPrice(
      votingUnderlyingToken.target,
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
        advancedSettings: {
          borrowCap: ethers.parseEther("1"),
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
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
          borrowCap: ethers.parseEther("1"),
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
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
        .withArgs(escrowAddress, relBid, user1.address, refSpot, 0, 0);
    });

    it("should revert if bidding with insufficient premium", async function () {
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
          borrowCap: ethers.parseEther("1"),
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
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
      let rfqInitialization: DataTypes.RFQInitialization = {
        optionInfo: {
          underlyingToken: underlyingToken.target,
          settlementToken: settlementToken.target,
          notional: ethers.parseEther("100"),
          strike: ethers.parseEther("1"),
          earliestExercise: 0,
          expiry: (await provider.getBlock("latest")).timestamp + 86400 * 30, // 30 days
          advancedSettings: {
            borrowCap: ethers.parseEther("1"),
            oracle: mockOracle.target,
            premiumTokenIsUnderlying: false,
            votingDelegationAllowed: true,
            allowedDelegateRegistry: ethers.ZeroAddress,
          },
          oracle: mockOracle.target,
        },
        rfqQuote: {
          premium: ethers.parseEther("10"),
          validUntil: (await provider.getBlock("latest")).timestamp + 86400, // 1 day
          signature: ethers.ZeroHash, // Placeholder, will set later
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
      let rfqInitialization: DataTypes.RFQInitialization = {
        optionInfo: {
          underlyingToken: underlyingToken.target,
          settlementToken: settlementToken.target,
          notional: ethers.parseEther("100"),
          strike: ethers.parseEther("1"),
          earliestExercise: 0,
          expiry: (await provider.getBlock("latest")).timestamp + 86400 * 30, // 30 days
          advancedSettings: {
            borrowCap: ethers.parseEther("1"),
            oracle: mockOracle.target,
            premiumTokenIsUnderlying: false,
            votingDelegationAllowed: true,
            allowedDelegateRegistry: ethers.ZeroAddress,
          },
          oracle: mockOracle.target,
        },
        rfqQuote: {
          premium: ethers.parseEther("10"),
          validUntil: (await provider.getBlock("latest")).timestamp - 10, // Already expired
          signature: ethers.ZeroHash, // Placeholder, will set later
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
    it("should allow owner to withdraw after auction expiry", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: underlyingToken.target,
        settlementToken: settlementToken.target,
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
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
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
        underlyingToken: underlyingToken.target,
        settlementToken: settlementToken.target,
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
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
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
          borrowCap: ethers.parseEther("1"),
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
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
          borrowCap: ethers.parseEther("1"),
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
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
          borrowCap: ethers.parseEther("1"),
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
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
          borrowCap: 0n, // Disallow borrowing
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
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
          borrowCap: ethers.parseEther("1"),
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
        oracle: mockOracle.target,
      };

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
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: votingUnderlyingToken.target,
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
          borrowCap: ethers.parseEther("1"),
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
        oracle: mockOracle.target,
      };

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
          borrowCap: ethers.parseEther("1"),
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: false, // Disallow delegation
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

  describe("Edge Cases and Reverts", function () {
    it("should revert when creating escrow with same nonce", async function () {
      const auctionInitialization: DataTypes.AuctionInitialization = {
        underlyingToken: underlyingToken.target,
        settlementToken: settlementToken.target,
        notional: ethers.parseEther("100") / 2n,
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
          oracle: mockOracle.target,
          premiumTokenIsUnderlying: false,
          votingDelegationAllowed: true,
          allowedDelegateRegistry: ethers.ZeroAddress,
        },
        oracle: mockOracle.target,
      };

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
  });
});
