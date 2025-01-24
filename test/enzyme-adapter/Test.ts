const { expect } = require("chai");
import { ethers } from "hardhat";
import {
  Router,
  Escrow,
  MockERC20,
  MockOracle,
  MysoPositionLib,
} from "../../typechain-types";
import {
  setupTestContracts,
  getAuctionInitialization,
  getRFQInitialization,
  rfqSignaturePayload,
} from "../helpers";

/**
 * Encodes RFQInitialization struct into ABI format.
 *
 * @param rfqInitialization - The RFQ initialization object containing optionInfo and rfqQuote.
 * @param actionId - The action ID for the RFQ process (default is 0 for Take Quote).
 * @returns Encoded action data ready for contract interaction.
 */
export function encodeRFQInitialization(
  rfqInitialization: any,
  actionId: number = 0
): string {
  const abiCoder = new ethers.AbiCoder();

  // Define the ABI structure for the RFQInitialization struct
  const rfqAbi = [
    "tuple((address,uint48,address,uint48,uint128,uint128,(uint64,address,bool,bool,address)),(uint128,uint256,bytes,address))",
  ];

  // Encode the struct values
  const encodedRfqInitialization = abiCoder.encode(rfqAbi, [
    [
      [
        rfqInitialization.optionInfo.underlyingToken,
        rfqInitialization.optionInfo.expiry,
        rfqInitialization.optionInfo.settlementToken,
        rfqInitialization.optionInfo.earliestExercise,
        rfqInitialization.optionInfo.notional,
        rfqInitialization.optionInfo.strike,
        [
          rfqInitialization.optionInfo.advancedSettings.borrowCap,
          rfqInitialization.optionInfo.advancedSettings.oracle,
          rfqInitialization.optionInfo.advancedSettings
            .premiumTokenIsUnderlying,
          rfqInitialization.optionInfo.advancedSettings.votingDelegationAllowed,
          rfqInitialization.optionInfo.advancedSettings.allowedDelegateRegistry,
        ],
      ],
      [
        rfqInitialization.rfqQuote.premium,
        rfqInitialization.rfqQuote.validUntil,
        rfqInitialization.rfqQuote.signature,
        rfqInitialization.rfqQuote.eip1271Maker,
      ],
    ],
  ]);

  // Wrap the action ID and encoded struct into a single payload
  const actionData = abiCoder.encode(
    ["uint256", "bytes"],
    [ethers.toBigInt(actionId), encodedRfqInitialization]
  );

  return actionData;
}

describe("Router Contract", function () {
  let router: Router;
  let escrowImpl: Escrow;
  let settlementToken: MockERC20;
  let underlyingToken: MockERC20;
  let mockOracle: MockOracle;
  let mysoPositionLib: MysoPositionLib;
  let mockEnzymeVault: any;
  let tradingFirm: any;
  let user2: any;
  let provider: any;
  const CHAIN_ID = 31337;

  beforeEach(async function () {
    const contracts = await setupTestContracts();
    ({
      owner: mockEnzymeVault,
      user1: tradingFirm,
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

  describe("Create Escrow via Auction", function () {
    it("should create an escrow via escrow", async function () {
      // Prepare the auction initialization parameters with latest struct updates
      const auctionInitialization = await getAuctionInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        oracleAddress: String(mockOracle.target),
      });

      // Define action ID for createAuction (ensure it's aligned with latest contract)
      const actionId = ethers.toBigInt(1);

      const abiCoder = new ethers.AbiCoder();
      const actionArgs = abiCoder.encode(
        [
          "tuple(address,address,uint256,(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256),(uint256,address,bool,bool,address))",
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

      // @dev: mock vault sending underlying notional to EP before calling position lib
      await underlyingToken
        .connect(mockEnzymeVault)
        .transfer(mysoPositionLib.target, auctionInitialization.notional);

      // Check initial number of escrows
      expect(await router.numEscrows()).to.equal(0);

      // Call receiveCallFromVault to trigger createAuction
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(actionData)
      ).to.emit(mysoPositionLib, "EscrowCreated"); // Ensure event is emitted

      // Validate the number of escrows increased
      expect(await router.numEscrows()).to.equal(1);

      // Verify the auction was added to MysoPositionLib's escrow list
      const numEscrows = await mysoPositionLib.getNumEscrows();
      expect(numEscrows).to.equal(1);

      const escrows = await mysoPositionLib.getEscrowAddresses(0, 1);
      expect(escrows[0]).to.not.be.undefined;

      // Verify that calling getManagedAssets reverts when open escrows
      await expect(mysoPositionLib.getManagedAssets()).to.be.reverted;

      // Prepare withdraw action arguments
      const withdrawActionArgs = abiCoder.encode(
        ["address[]", "address[]", "uint256[]"],
        [
          [escrows[0]], // Escrow address
          [underlyingToken.target], // Token address
          [auctionInitialization.notional], // Withdrawal amount
        ]
      );

      const withdrawActionData = abiCoder.encode(
        ["uint256", "bytes"],
        [ethers.toBigInt(3), withdrawActionArgs] // Action ID for withdraw
      );

      // Expect withdraw transaction to succeed
      const openEscrowsPre = await mysoPositionLib.getNumOpenEscrows();
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(withdrawActionData)
      )
        .to.emit(mysoPositionLib, "WithdrawFromEscrow")
        .withArgs(
          escrows[0],
          underlyingToken.target,
          auctionInitialization.notional
        );

      // Verify the escrow has not been marked as closed
      const openEscrowsPost = await mysoPositionLib.getNumOpenEscrows();
      expect(openEscrowsPre).to.equal(openEscrowsPost);
      expect(await mysoPositionLib.isEscrowClosed(escrows[0])).to.equal(false);

      // Prepare close and sweep action arguments
      const closeAndSweepActionArgs = abiCoder.encode(
        ["address[]"],
        [[escrows[0]]]
      );

      const closeAndSweepActionData = abiCoder.encode(
        ["uint256", "bytes"],
        [ethers.toBigInt(2), closeAndSweepActionArgs]
      );
      // @dev: 0 balances swept as already previously withdrawn
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(closeAndSweepActionData)
      )
        .to.emit(mysoPositionLib, "EscrowClosedAndSweeped")
        .withArgs(
          escrows[0],
          underlyingToken.target,
          0n,
          settlementToken.target,
          0n
        );

      // Verify now no more open escrows
      expect(await mysoPositionLib.getNumOpenEscrows()).to.equal(0);
      expect(await mysoPositionLib.isEscrowClosed(escrows[0])).to.equal(true);

      // Verify that calling getManagedAssets() now possible
      await mysoPositionLib.getManagedAssets();
    });
  });

  describe("Create Escrow via RFQ/Take Quote", function () {
    it("should create an escrow via RFQ/Take Quote", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await tradingFirm.signMessage(
        ethers.getBytes(payloadHash)
      );

      // Trading firm approves to pay premium
      await settlementToken
        .connect(tradingFirm)
        .approve(router.target, ethers.MaxUint256);
      rfqInitialization.rfqQuote.signature = signature;

      // @dev: mock vault sending underlying notional to EP before calling position lib
      await underlyingToken
        .connect(mockEnzymeVault)
        .transfer(
          mysoPositionLib.target,
          rfqInitialization.optionInfo.notional
        );

      // Wrap the action ID and encoded args into a single bytes payload
      const actionData = encodeRFQInitialization(rfqInitialization, 0);

      // Call receiveCallFromVault to create an escrow via RFQ
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(actionData)
      ).to.emit(mysoPositionLib, "EscrowCreated");

      // Validate the number of escrows increased
      expect(await router.numEscrows()).to.equal(1);

      // Verify escrow tracking in MysoPositionLib
      const numEscrows = await mysoPositionLib.getNumEscrows();
      expect(numEscrows).to.equal(1);

      const escrows = await mysoPositionLib.getEscrowAddresses(0, 1);
      expect(escrows[0]).to.not.be.undefined;

      // Verify that calling getManagedAssets reverts when open escrows
      await expect(mysoPositionLib.getManagedAssets()).to.be.reverted;

      // Prepare close and sweep action arguments
      const abiCoder = new ethers.AbiCoder();
      const closeAndSweepActionArgs = abiCoder.encode(
        ["address[]"],
        [[escrows[0]]]
      );
      const closeAndSweepActionData = abiCoder.encode(
        ["uint256", "bytes"],
        [ethers.toBigInt(2), closeAndSweepActionArgs]
      );
      // Verify cannot sweep while option still ongoing
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(closeAndSweepActionData)
      ).to.be.revertedWith("__closeAndSweepEscrow: Option hasn't expired yet");

      // Move forward in time post expiry
      const block = await ethers.provider.getBlock("latest");
      const blockTimestamp = block?.timestamp || new Date().getTime() / 1000;
      const moveForwardTime =
        Number(rfqInitialization.optionInfo.expiry) - blockTimestamp + 1;
      await ethers.provider.send("evm_increaseTime", [moveForwardTime]);
      await ethers.provider.send("evm_mine", []);

      // Sweeping should now be possible
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(closeAndSweepActionData)
      )
        .to.emit(mysoPositionLib, "EscrowClosedAndSweeped")
        .withArgs(
          escrows[0],
          underlyingToken.target,
          rfqInitialization.optionInfo.notional,
          settlementToken.target,
          0n
        );

      // Verify now no more open escrows
      expect(await mysoPositionLib.getNumOpenEscrows()).to.equal(0);
      expect(await mysoPositionLib.isEscrowClosed(escrows[0])).to.equal(true);

      // Verify that calling getManagedAssets() now possible
      await mysoPositionLib.getManagedAssets();
    });

    it("should handle 100% exercise scenario correctly", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await tradingFirm.signMessage(
        ethers.getBytes(payloadHash)
      );

      // Trading firm approves to pay premium
      await settlementToken
        .connect(tradingFirm)
        .approve(router.target, ethers.MaxUint256);
      rfqInitialization.rfqQuote.signature = signature;

      // @dev: mock vault sending underlying notional to EP before calling position lib
      await underlyingToken
        .connect(mockEnzymeVault)
        .transfer(
          mysoPositionLib.target,
          rfqInitialization.optionInfo.notional
        );

      // Wrap the action ID and encoded args into a single bytes payload
      const actionData = encodeRFQInitialization(rfqInitialization, 0);

      // Call receiveCallFromVault to create an escrow via RFQ
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(actionData)
      ).to.emit(mysoPositionLib, "EscrowCreated");

      // Get latest escrow
      const escrows = await mysoPositionLib.getEscrowAddresses(0, 1);

      // Trading firm exercise 100%
      await router
        .connect(tradingFirm)
        .exercise(
          escrows[0],
          tradingFirm.address,
          rfqInitialization.optionInfo.notional,
          true,
          []
        );

      // Check in case of 100% exercise vault manager can close and sweep prior to expiry
      const abiCoder = new ethers.AbiCoder();
      const closeAndSweepActionArgs = abiCoder.encode(
        ["address[]"],
        [[escrows[0]]]
      );
      const closeAndSweepActionData = abiCoder.encode(
        ["uint256", "bytes"],
        [ethers.toBigInt(2), closeAndSweepActionArgs]
      );

      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(closeAndSweepActionData)
      )
        .to.emit(mysoPositionLib, "EscrowClosedAndSweeped")
        .withArgs(
          escrows[0],
          underlyingToken.target,
          0n,
          settlementToken.target,
          0n
        );

      // Verify now no more open escrows
      expect(await mysoPositionLib.getNumOpenEscrows()).to.equal(0);
      expect(await mysoPositionLib.isEscrowClosed(escrows[0])).to.equal(true);

      // Verify that calling getManagedAssets() now possible
      await mysoPositionLib.getManagedAssets();
    });

    it("should handle partial exercise scenario correctly", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await tradingFirm.signMessage(
        ethers.getBytes(payloadHash)
      );

      // Trading firm approves to pay premium
      await settlementToken
        .connect(tradingFirm)
        .approve(router.target, ethers.MaxUint256);
      rfqInitialization.rfqQuote.signature = signature;

      // @dev: mock vault sending underlying notional to EP before calling position lib
      await underlyingToken
        .connect(mockEnzymeVault)
        .transfer(
          mysoPositionLib.target,
          rfqInitialization.optionInfo.notional
        );

      // Wrap the action ID and encoded args into a single bytes payload
      const actionData = encodeRFQInitialization(rfqInitialization, 0);

      // Call receiveCallFromVault to create an escrow via RFQ
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(actionData)
      ).to.emit(mysoPositionLib, "EscrowCreated");

      // Get latest escrow
      const escrows = await mysoPositionLib.getEscrowAddresses(0, 1);

      // Trading firm exercise 50%
      await router
        .connect(tradingFirm)
        .exercise(
          escrows[0],
          tradingFirm.address,
          rfqInitialization.optionInfo.notional / 2n,
          true,
          []
        );

      // Check in case of partial exercise vault manager cannot close and sweep prior to expiry
      const abiCoder = new ethers.AbiCoder();
      const closeAndSweepActionArgs = abiCoder.encode(
        ["address[]"],
        [[escrows[0]]]
      );
      const closeAndSweepActionData = abiCoder.encode(
        ["uint256", "bytes"],
        [ethers.toBigInt(2), closeAndSweepActionArgs]
      );

      // Should fail
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(closeAndSweepActionData)
      ).to.be.reverted;

      // Move forward in time post expiry
      const block = await ethers.provider.getBlock("latest");
      const blockTimestamp = block?.timestamp || new Date().getTime() / 1000;
      const moveForwardTime =
        Number(rfqInitialization.optionInfo.expiry) - blockTimestamp + 1;
      await ethers.provider.send("evm_increaseTime", [moveForwardTime]);
      await ethers.provider.send("evm_mine", []);

      // Closing and sweeping post expiry should work
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(closeAndSweepActionData)
      )
        .to.emit(mysoPositionLib, "EscrowClosedAndSweeped")
        .withArgs(
          escrows[0],
          underlyingToken.target,
          rfqInitialization.optionInfo.notional / 2n,
          settlementToken.target,
          0n
        );

      // Verify now no more open escrows
      expect(await mysoPositionLib.getNumOpenEscrows()).to.equal(0);
      expect(await mysoPositionLib.isEscrowClosed(escrows[0])).to.equal(true);

      // Verify that calling getManagedAssets() now possible
      await mysoPositionLib.getManagedAssets();
    });

    it("should handle 100% borrow w/o repay scenario correctly", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        borrowCap: ethers.parseEther("1"), // 100% borrow cap
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await tradingFirm.signMessage(
        ethers.getBytes(payloadHash)
      );

      // Trading firm approves to pay premium
      await settlementToken
        .connect(tradingFirm)
        .approve(router.target, ethers.MaxUint256);
      rfqInitialization.rfqQuote.signature = signature;

      // @dev: mock vault sending underlying notional to EP before calling position lib
      await underlyingToken
        .connect(mockEnzymeVault)
        .transfer(
          mysoPositionLib.target,
          rfqInitialization.optionInfo.notional
        );

      // Wrap the action ID and encoded args into a single bytes payload
      const actionData = encodeRFQInitialization(rfqInitialization, 0);

      // Call receiveCallFromVault to create an escrow via RFQ
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(actionData)
      ).to.emit(mysoPositionLib, "EscrowCreated");

      // Get latest escrow
      const escrows = await mysoPositionLib.getEscrowAddresses(0, 1);

      // Trading firm borrows 100%
      await router
        .connect(tradingFirm)
        .borrow(
          escrows[0],
          tradingFirm.address,
          rfqInitialization.optionInfo.notional
        );

      // Check in case of borrow vault manager cannot close and sweep prior to expiry
      const abiCoder = new ethers.AbiCoder();
      const closeAndSweepActionArgs = abiCoder.encode(
        ["address[]"],
        [[escrows[0]]]
      );
      const closeAndSweepActionData = abiCoder.encode(
        ["uint256", "bytes"],
        [ethers.toBigInt(2), closeAndSweepActionArgs]
      );

      // Should fail
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(closeAndSweepActionData)
      ).to.be.reverted;

      // Move forward in time post expiry
      const block = await ethers.provider.getBlock("latest");
      const blockTimestamp = block?.timestamp || new Date().getTime() / 1000;
      const moveForwardTime =
        Number(rfqInitialization.optionInfo.expiry) - blockTimestamp + 1;
      await ethers.provider.send("evm_increaseTime", [moveForwardTime]);
      await ethers.provider.send("evm_mine", []);

      // Closing and sweeping post expiry should work
      const underlyingTokenDecimals = await underlyingToken.decimals();
      const expectedSettlementTokenSweep =
        (rfqInitialization.optionInfo.strike *
          rfqInitialization.optionInfo.notional) /
        10n ** underlyingTokenDecimals;
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(closeAndSweepActionData)
      )
        .to.emit(mysoPositionLib, "EscrowClosedAndSweeped")
        .withArgs(
          escrows[0],
          underlyingToken.target,
          0n,
          settlementToken.target,
          expectedSettlementTokenSweep
        );

      // Verify now no more open escrows
      expect(await mysoPositionLib.getNumOpenEscrows()).to.equal(0);
      expect(await mysoPositionLib.isEscrowClosed(escrows[0])).to.equal(true);

      // Verify that calling getManagedAssets() now possible
      await mysoPositionLib.getManagedAssets();
    });

    it("should handle partial borrow w/o repay scenario correctly", async function () {
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
        borrowCap: ethers.parseEther("1"), // 100% borrow cap
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, CHAIN_ID);
      const signature = await tradingFirm.signMessage(
        ethers.getBytes(payloadHash)
      );

      // Trading firm approves to pay premium
      await settlementToken
        .connect(tradingFirm)
        .approve(router.target, ethers.MaxUint256);
      rfqInitialization.rfqQuote.signature = signature;

      // @dev: mock vault sending underlying notional to EP before calling position lib
      await underlyingToken
        .connect(mockEnzymeVault)
        .transfer(
          mysoPositionLib.target,
          rfqInitialization.optionInfo.notional
        );

      // Wrap the action ID and encoded args into a single bytes payload
      const actionData = encodeRFQInitialization(rfqInitialization, 0);

      // Call receiveCallFromVault to create an escrow via RFQ
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(actionData)
      ).to.emit(mysoPositionLib, "EscrowCreated");

      // Get latest escrow
      const escrows = await mysoPositionLib.getEscrowAddresses(0, 1);

      // Trading firm borrows 50%
      await router
        .connect(tradingFirm)
        .borrow(
          escrows[0],
          tradingFirm.address,
          rfqInitialization.optionInfo.notional / 2n
        );

      // Check in case of borrow vault manager cannot close and sweep prior to expiry
      const abiCoder = new ethers.AbiCoder();
      const closeAndSweepActionArgs = abiCoder.encode(
        ["address[]"],
        [[escrows[0]]]
      );
      const closeAndSweepActionData = abiCoder.encode(
        ["uint256", "bytes"],
        [ethers.toBigInt(2), closeAndSweepActionArgs]
      );

      // Should fail
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(closeAndSweepActionData)
      ).to.be.reverted;

      // Move forward in time post expiry
      const block = await ethers.provider.getBlock("latest");
      const blockTimestamp = block?.timestamp || new Date().getTime() / 1000;
      const moveForwardTime =
        Number(rfqInitialization.optionInfo.expiry) - blockTimestamp + 1;
      await ethers.provider.send("evm_increaseTime", [moveForwardTime]);
      await ethers.provider.send("evm_mine", []);

      // Closing and sweeping post expiry should work
      // @dev: since trading firm only partially borrowed the escrow
      // will have two relevant balances, i.e., 50% of non-borrowed and
      // non-exercised underlying tokens and settlement tokens left as
      // collateral but not reclaimed as borrowed amount was not repaid
      // before expiry
      const underlyingTokenDecimals = await underlyingToken.decimals();
      const expectedUnderlyingTokenSweep =
        rfqInitialization.optionInfo.notional / 2n;
      const expectedSettlementTokenSweep =
        (rfqInitialization.optionInfo.strike *
          rfqInitialization.optionInfo.notional) /
        2n /
        10n ** underlyingTokenDecimals;
      await expect(
        mysoPositionLib
          .connect(mockEnzymeVault)
          .receiveCallFromVault(closeAndSweepActionData)
      )
        .to.emit(mysoPositionLib, "EscrowClosedAndSweeped")
        .withArgs(
          escrows[0],
          underlyingToken.target,
          expectedUnderlyingTokenSweep,
          settlementToken.target,
          expectedSettlementTokenSweep
        );

      // Verify now no more open escrows
      expect(await mysoPositionLib.getNumOpenEscrows()).to.equal(0);
      expect(await mysoPositionLib.isEscrowClosed(escrows[0])).to.equal(true);

      // Verify that calling getManagedAssets() now possible
      await mysoPositionLib.getManagedAssets();
    });
  });
});
