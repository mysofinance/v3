import { expect } from "chai";
import { ethers } from "hardhat";
import {
    Router,
    Escrow,
    MockERC20,
    MockOracle,
    FeeHandler,
    DataTypes,
} from "../typechain-types";

describe("Router Contract Fee Tests", function () {
    let router: Router;
    let escrowImpl: Escrow;
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
        [owner, user1, user2] = await ethers.getSigners();
        provider = owner.provider;

        // Deploy mock ERC20 tokens
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
            escrowImpl.target
        );

        // Deploy FeeHandler
        const FeeHandler = await ethers.getContractFactory("FeeHandler");
        feeHandler = await FeeHandler.deploy(
            owner.address,
            router.target,
            ethers.parseEther("0.01"), // 1% match fee
            ethers.parseEther("0.05"), // 5% distribution partner share
            ethers.parseEther("0.001") // 0.1% exercise fee
        );

        await router.connect(owner).setFeeHandler(feeHandler.target);

        // Deploy mock oracle
        const MockOracle = await ethers.getContractFactory("MockOracle");
        mockOracle = await MockOracle.deploy();
        await mockOracle.setPrice(
            underlyingToken.target,
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

    describe("Access Control", function () {
        it("Should allow only owner to call withdraw", async function () {
            // Attempt withdraw from non-owner
            await expect(
                feeHandler.connect(user1).withdraw(user1.address, underlyingToken.target, ethers.parseEther("10"))
            ).to.be.revertedWithCustomError(feeHandler, "OwnableUnauthorizedAccount");

            const initialOwnerBalance = await underlyingToken.balanceOf(owner.address);

            await underlyingToken.connect(user2).transfer(feeHandler.target, ethers.parseEther("10"))
            // Owner can withdraw
            await expect(feeHandler.connect(owner).withdraw(owner.address, underlyingToken.target, ethers.parseEther("10")))
                .to.emit(feeHandler, "Withdraw")
                .withArgs(owner.address, underlyingToken.target, ethers.parseEther("10"));

            const finalOwnerBalance = await underlyingToken.balanceOf(owner.address);

            // Check balance
            expect(finalOwnerBalance - initialOwnerBalance).to.equal(ethers.parseEther("10"));
        });

        it("Should allow only owner to setMatchFeeInfo", async function () {
            // Attempt to setMatchFeeInfo from non-owner
            await expect(
                feeHandler.connect(user1).setMatchFeeInfo(ethers.parseEther("0.05"), ethers.parseEther("0.3"))
            ).to.be.revertedWithCustomError(feeHandler, "OwnableUnauthorizedAccount");

            // Owner sets matchFeeInfo
            await expect(feeHandler.connect(owner).setMatchFeeInfo(ethers.parseEther("0.05"), ethers.parseEther("0.3")))
                .to.emit(feeHandler, "SetMatchFeeInfo")
                .withArgs(ethers.parseEther("0.05"), ethers.parseEther("0.3"));

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
            await expect(feeHandler.connect(owner).setExerciseFee(ethers.parseEther("0.002")))
                .to.emit(feeHandler, "SetExerciseFee")
                .withArgs(ethers.parseEther("0.002"));

            // Verify change
            expect(await feeHandler.exerciseFee()).to.equal(ethers.parseEther("0.002"));
        });

        it("Should allow only owner to setDistPartners", async function () {
            const accounts = [user1.address, user2.address];
            const statuses = [true, true];

            // Attempt to setDistPartners from non-owner
            await expect(
                feeHandler.connect(user1).setDistPartners(accounts, statuses)
            ).to.be.revertedWithCustomError(feeHandler, "OwnableUnauthorizedAccount");

            // Owner sets distPartners
            await expect(feeHandler.connect(owner).setDistPartners(accounts, statuses))
                .to.emit(feeHandler, "SetDistributionPartners")
                .withArgs(accounts, statuses);

            // Verify changes
            expect(await feeHandler.isDistPartner(user1.address)).to.be.true;
            expect(await feeHandler.isDistPartner(user2.address)).to.be.true;
        });

        it("Should allow only router to call provisionFees", async function () {
            // Attempt to call provisionFees from non-router
            await expect(
                feeHandler.connect(user1).provisionFees(underlyingToken.target, ethers.parseEther("10"))
            ).to.be.reverted;
        });
    });

    describe("Fees in Auction", function () {
        it("should apply correct fees when bidding on an auction", async function () {
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

            // Approve settlement token for bidding and fees
            const bidAmount = ethers.parseEther("2"); // 2% of notional
            await settlementToken
                .connect(user1)
                .approve(router.target, bidAmount);

            const relBid = ethers.parseEther("0.02");
            const refSpot = ethers.parseUnits("1", 6);
            const data: any[] = [];

            // Get initial balances
            const initialOwnerBalance = await settlementToken.balanceOf(owner.address);
            const initialUser1Balance = await settlementToken.balanceOf(user1.address);
            const initialFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);

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
            const finalFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);

            // Calculate expected fees
            const expectedMatchFee = auctionInitialization.auctionParams.relPremiumStart * refSpot * ethers.parseEther("0.01") * auctionInitialization.notional / (BASE * BASE * BASE);

            // Check balances
            expect(finalOwnerBalance).to.be.gt(initialOwnerBalance);
            expect(finalUser1Balance).to.be.lt(initialUser1Balance);
            expect(finalFeeHandlerBalance).to.equal(initialFeeHandlerBalance + expectedMatchFee);
        });
    });

    describe("Fees in RFQ", function () {
        it("should apply correct fees when taking a quote", async function () {
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
                    premium: ethers.parseEther("2"), // 2% premium
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

            // Get initial balances
            const initialOwnerBalance = await settlementToken.balanceOf(owner.address);
            const initialUser1Balance = await underlyingToken.balanceOf(user1.address);
            const initialFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);

            // Take the quote
            await router
                .connect(user1)
                .takeQuote(user1.address, rfqInitialization, ethers.ZeroAddress);

            // Get final balances
            const finalOwnerBalance = await settlementToken.balanceOf(owner.address);
            const finalUser1Balance = await underlyingToken.balanceOf(user1.address);
            const finalFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);

            // Calculate expected fees
            const expectedMatchFee = rfqInitialization.rfqQuote.premium * ethers.parseEther("0.01") / BASE;

            // Check balances
            expect(finalOwnerBalance).to.be.lt(initialOwnerBalance);
            expect(finalUser1Balance).to.be.lt(initialUser1Balance);
            expect(finalFeeHandlerBalance).to.equal(initialFeeHandlerBalance + expectedMatchFee);
        });
    });

    describe("Exercise Fees", function () {
        it("should apply correct fees when exercising a call option", async function () {
            await feeHandler.connect(owner).setExerciseFee(ethers.parseEther("0.001"));
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
            const initialOwnerBalance = await underlyingToken.balanceOf(owner.address);
            const initialUser1Balance = await settlementToken.balanceOf(user1.address);
            const initialFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);

            // Exercise the call
            await router
                .connect(user1)
                .exercise(
                    escrowAddress,
                    user1.address,
                    ethers.parseEther("50"), // Exercising half the notional
                    true, // Pay in settlement token
                    []
                );

            // Get final balances
            const finalOwnerBalance = await underlyingToken.balanceOf(owner.address);
            const finalUser1Balance = await settlementToken.balanceOf(user1.address);
            const finalFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);

            // Calculate expected fees
            const exerciseAmount = ethers.parseEther("50");
            const expectedExerciseFee = exerciseAmount * ethers.parseEther("0.001") / BASE;

            // Check balances
            expect(finalOwnerBalance).to.be.lt(initialOwnerBalance);
            expect(finalUser1Balance).to.be.lt(initialUser1Balance);
            expect(finalFeeHandlerBalance).to.equal(initialFeeHandlerBalance + expectedExerciseFee);
        });
    });

    describe("Fee Limits", function () {
        it("should respect maximum fee limits", async function () {
            // Set fees to maximum allowed values
            await feeHandler.connect(owner).setMatchFeeInfo(MAX_MATCH_FEE, BASE);
            await feeHandler.connect(owner).setExerciseFee(MAX_EXERCISE_FEE);

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

            // Start auction
            await underlyingToken
                .connect(owner)
                .approve(router.target, auctionInitialization.notional);
            await router
                .connect(owner)
                .createAuction(owner.address, auctionInitialization);

            const escrows = await router.getEscrows(0, 1);
            const escrowAddress = escrows[0];

            // Bid on auction
            const bidAmount = ethers.parseEther("20"); // 20% of notional
            await settlementToken
                .connect(user1)
                .approve(router.target, bidAmount * 2n); // Approve extra for fees
            const relBid = ethers.parseEther("0.2");
            const refSpot = ethers.parseUnits("1", 6);
            const data: any[] = [];

            const initialFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);

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

            const finalFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);

            // Check that the fee doesn't exceed the maximum
            const actualFee = finalFeeHandlerBalance - initialFeeHandlerBalance;
            const maxPossibleFee = bidAmount * MAX_MATCH_FEE / BASE;
            expect(actualFee).to.be.lte(maxPossibleFee);

            // Exercise the option
            await ethers.provider.send("evm_increaseTime", [86400 * 7]);
            await ethers.provider.send("evm_mine", []);

            const exerciseAmount = ethers.parseEther("50");
            await settlementToken
                .connect(user1)
                .approve(router.target, exerciseAmount * 2n); // Approve extra for fees

            const exerciseInitialFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);

            await router
                .connect(user1)
                .exercise(
                    escrowAddress,
                    user1.address,
                    exerciseAmount,
                    true, // Pay in settlement token
                    []
                );

            const exerciseFinalFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);

            // Check that the exercise fee doesn't exceed the maximum
            const actualExerciseFee = exerciseFinalFeeHandlerBalance - exerciseInitialFeeHandlerBalance;
            const maxPossibleExerciseFee = exerciseAmount * MAX_EXERCISE_FEE / BASE;
            expect(actualExerciseFee).to.be.lte(maxPossibleExerciseFee);
        });

        it("should revert when trying to set fees above maximum limits", async function () {
            await expect(
                feeHandler.connect(owner).setMatchFeeInfo(MAX_MATCH_FEE + 1n, BASE)
            ).to.be.revertedWithCustomError(feeHandler, "InvalidMatchFee");

            await expect(
                feeHandler.connect(owner).setExerciseFee(MAX_EXERCISE_FEE + 1n)
            ).to.be.revertedWithCustomError(feeHandler, "InvalidExerciseFee");
        });

        it("should handle fee distribution to distribution partners correctly", async function () {
            // Set a distribution partner
            await feeHandler.connect(owner).setDistPartners([user2.address], [true]);

            // Set fees
            const matchFee = ethers.parseEther("0.01"); // 1%
            const distPartnerShare = ethers.parseEther("0.05"); // 5%
            await feeHandler.connect(owner).setMatchFeeInfo(matchFee, distPartnerShare);

            const auctionInitialization: DataTypes.AuctionInitialization = {
                underlyingToken: underlyingToken.target,
                settlementToken: settlementToken.target,
                notional: ethers.parseEther("100"),
                auctionParams: {
                    relStrike: ethers.parseEther("1"),
                    tenor: 86400 * 30,
                    earliestExerciseTenor: 86400 * 7,
                    relPremiumStart: ethers.parseEther("0.01"),
                    relPremiumFloor: ethers.parseEther("0.005"),
                    decayDuration: 86400 * 7,
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

            // Start auction
            await underlyingToken
                .connect(owner)
                .approve(router.target, auctionInitialization.notional);
            await router
                .connect(owner)
                .createAuction(owner.address, auctionInitialization);

            const escrows = await router.getEscrows(0, 1);
            const escrowAddress = escrows[0];

            // Bid on auction
            const bidAmount = ethers.parseEther("10");
            await settlementToken
                .connect(user1)
                .approve(router.target, bidAmount * 2n);
            const relBid = ethers.parseEther("0.1");
            const refSpot = ethers.parseUnits("1", 6);
            const data: any[] = [];

            const initialFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);
            console.log('initialFeeHandlerBalance ', initialFeeHandlerBalance.toString());
            const initialDistPartnerBalance = await settlementToken.balanceOf(user2.address);

            await router
                .connect(user1)
                .bidOnAuction(
                    escrowAddress,
                    user1.address,
                    relBid,
                    refSpot,
                    data,
                    user2.address // Use distribution partner
                );

            const finalFeeHandlerBalance = await settlementToken.balanceOf(feeHandler.target);
            const finalDistPartnerBalance = await settlementToken.balanceOf(user2.address);

            // Check fee distribution
            const totalFee = auctionInitialization.auctionParams.relPremiumStart * refSpot * ethers.parseEther("0.01") * auctionInitialization.notional / (BASE * BASE * BASE);
            const expectedDistPartnerFee = totalFee * distPartnerShare / BASE;
            const expectedProtocolFee = totalFee - expectedDistPartnerFee;

            expect(finalFeeHandlerBalance - initialFeeHandlerBalance).to.equal(expectedProtocolFee);
            expect(finalDistPartnerBalance - initialDistPartnerBalance).to.equal(expectedDistPartnerFee);
        });
    });
});