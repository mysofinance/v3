const { expect } = require("chai");
import { ethers } from "hardhat";
import {
  Router,
  Escrow,
  MockERC20,
  MockOracle,
  MysoPositionLib,
} from "../../typechain-types";
import { setupTestContracts, getAuctionInitialization } from "../helpers";

describe("Router Contract", function () {
  let router: Router;
  let escrowImpl: Escrow;
  let settlementToken: MockERC20;
  let underlyingToken: MockERC20;
  let mockOracle: MockOracle;
  let mysoPositionLib: MysoPositionLib;
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

    const MysoPositionLib = await ethers.getContractFactory("MysoPositionLib");
    mysoPositionLib = await MysoPositionLib.deploy(router.target);
  });

  describe("Create Auction", function () {
    it("should be able to create an auction and withdraw through the external position instance", async function () {
      // Prepare the auction initialization parameters
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });

      // Encode the action ID and arguments for createAuction
      const actionId = 1; // Assuming action ID for createAuction is 1

      const abiCoder = new ethers.AbiCoder();
      const actionArgs = abiCoder.encode(
        [
          "tuple(address,address,uint128,(uint128,uint48,uint48,uint32,uint32,uint64,uint64,uint128,uint128),(uint64,address,bool,bool,address))",
        ],
        [
          [
            auctionInitialization.underlyingToken,
            auctionInitialization.settlementToken,
            auctionInitialization.notional,
            [
              auctionInitialization.auctionParams.relStrike,
              auctionInitialization.auctionParams.tenor,
              auctionInitialization.auctionParams.earliestExerciseTenor,
              auctionInitialization.auctionParams.decayStartTime,
              auctionInitialization.auctionParams.decayDuration,
              auctionInitialization.auctionParams.relPremiumStart,
              auctionInitialization.auctionParams.relPremiumFloor,
              auctionInitialization.auctionParams.minSpot,
              auctionInitialization.auctionParams.maxSpot,
            ],
            [
              auctionInitialization.advancedSettings.borrowCap,
              auctionInitialization.advancedSettings.oracle,
              auctionInitialization.advancedSettings.premiumTokenIsUnderlying,
              auctionInitialization.advancedSettings.votingDelegationAllowed,
              auctionInitialization.advancedSettings.allowedDelegateRegistry,
            ],
          ],
        ]
      );

      const actionData = abiCoder.encode(
        ["uint256", "bytes"],
        [actionId, actionArgs]
      );

      await underlyingToken
        .connect(owner)
        .approve(mysoPositionLib.target, ethers.MaxUint256);

      expect(await router.numEscrows()).to.be.equal(0);

      // Call receiveCallFromVault to trigger createAuction
      await mysoPositionLib.connect(owner).receiveCallFromVault(actionData);

      expect(await router.numEscrows()).to.be.equal(1);

      // Verify auction was added to MysoPositionLib's escrow list
      const numEscrows = await mysoPositionLib.getNumEscrows();
      expect(numEscrows).to.equal(1);

      const escrows = await mysoPositionLib.getEscrowAddresses(0, 1);
      expect(escrows[0]).to.not.be.undefined;

      // Withdraw tokens from the created escrow
      const withdrawActionArgs = abiCoder.encode(
        ["address[]", "address[]", "uint256[]"],
        [
          [escrows[0]],
          [underlyingToken.target],
          [auctionInitialization.notional],
        ]
      );

      const withdrawActionData = abiCoder.encode(
        ["uint256", "bytes"],
        [2, withdrawActionArgs] // Action ID for withdraw
      );

      // Expect withdraw transaction to succeed
      await mysoPositionLib
        .connect(owner)
        .receiveCallFromVault(withdrawActionData);
    });
  });
});
