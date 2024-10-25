const { expect } = require("chai");
const { ethers } = require("hardhat");
import {
  setupTestContracts,
  getRFQInitialization,
  rfqSignaturePayload,
  getLatestTimestamp,
  swapSignaturePayload,
} from "./helpers";
import { Router, Escrow, MockERC20, MockOracle } from "../typechain-types";
import { DataTypes } from "./DataTypes";

require("dotenv").config();

// Constants
const EIP1271_SAFE_ADDRESS = "0x6e96a002A8fDA96339b97674dcE5C02ab71bFC4c";
const SAFE_CALLBACK_CONTRACT_ADDRESS =
  "0xfd0732dc9e303f09fcef3a7388ad10a83459ec99";

const EIP1271_ABI = [
  "function getOwners() external view returns (address[])",
  "function checkNSignatures(bytes32 dataHash, bytes memory data, bytes memory signatures, uint256 requiredSignatures) public view",
  "function isValidSignature(bytes32 _dataHash, bytes calldata _signature) external view returns (bytes4)",
];

const SAFE_CALLBACK_ABI = [
  "function encodeMessageDataForSafe(address safe, bytes memory message) public view returns (bytes memory)",
];

// Helper method to prepare the signature with Safe-compatible v adjustment
function prepareSafeEIP1271Signature(signature: any) {
  const { v, r, s } = ethers.Signature.from(signature);

  // Adjust the v value for Safe's eth_sign compatibility
  // See: https://github.com/safe-global/safe-smart-account/blob/6fde75d29c8b52d5ac0c93a6fb7631d434b64119/contracts/Safe.sol#L319-L322
  const adjustedV = v >= 27 ? v + 4 : v; // Shift v by +4 to follow Safe's pre-signature logic

  return ethers.concat([r, s, ethers.toBeHex(adjustedV, 1)]);
}

describe("EIP-1271 Signer Tests", function () {
  let eip1271SignerKey: any;
  let signer: any;
  let signerAddress: any;
  let chainId: any;
  let eip1271Contract: any;

  before(async function () {
    eip1271SignerKey = process.env.SEPOLIA_EIP_1271_SIGNER_KEY;
    if (!eip1271SignerKey) {
      throw new Error("EIP1271 signer key is not defined in the .env file");
    }
    signer = new ethers.Wallet(eip1271SignerKey, ethers.provider);
    signerAddress = await signer.getAddress();
    chainId = await ethers.provider.send("eth_chainId");
  });

  it("should reconstruct and verify simple ecrecover", async function () {
    const messageHash = ethers.solidityPackedKeccak256(
      ["string"],
      ["Hello World"]
    );
    const signature = await signer.signMessage(ethers.getBytes(messageHash));
    const recoveredAddress = ethers.verifyMessage(
      ethers.getBytes(messageHash),
      signature
    );
    expect(recoveredAddress).to.equal(signerAddress);

    const TestRecover = await ethers.getContractFactory("TestRecover");
    const testRecover = await TestRecover.deploy();
    const simpleEcRecoverTest = await testRecover.testRecover(
      ethers.getBytes(messageHash),
      signature
    );
    expect(simpleEcRecoverTest).to.equal(signerAddress);
  });

  it("should reconstruct and verify a signature with Safe multisig checkNSignatures", async function () {
    if (chainId !== "0xa4b1") {
      console.log(
        "Skipping test: Only meant for forked mainnet on Arbitrum to test with Safe multisig (chain ID 42161)."
      );
      this.skip();
    }

    const messageHash = ethers.solidityPackedKeccak256(
      ["string"],
      ["Hello World"]
    );
    const signature = await signer.signMessage(ethers.getBytes(messageHash));
    const recoveredAddress = ethers.verifyMessage(
      ethers.getBytes(messageHash),
      signature
    );
    expect(recoveredAddress).to.equal(signerAddress);

    // Ensure signer is owner of Safe multisig
    eip1271Contract = new ethers.Contract(
      EIP1271_SAFE_ADDRESS,
      EIP1271_ABI,
      ethers.provider
    );
    const owners = await eip1271Contract.getOwners();
    expect(owners).to.include(signerAddress);

    // v value needs to be shifted for ETH prefixed message signature verification, see helper method
    const safeCompatibleEip1271Sig = prepareSafeEIP1271Signature(signature);

    // Check no revert when calling checkNSignatures on Safe multisig
    await eip1271Contract.checkNSignatures(
      ethers.getBytes(messageHash),
      "0x",
      safeCompatibleEip1271Sig,
      1
    );
  });

  it("should reconstruct and verify signature using Safe multisig isValidSignature", async function () {
    if (chainId !== "0xa4b1") {
      // 42161 in hexadecimal
      console.log(
        "Skipping test: Only meant for forked mainnet on Arbitrum to test with Safe multisig (chain ID 42161)."
      );
      this.skip();
    }

    // Ensure signer is owner of Safe multisig
    eip1271Contract = new ethers.Contract(
      EIP1271_SAFE_ADDRESS,
      EIP1271_ABI,
      ethers.provider
    );
    const owners = await eip1271Contract.getOwners();
    expect(owners).to.include(signerAddress);

    const abiCoder = new ethers.AbiCoder();
    const nonSafeMessage = abiCoder.encode(["string"], ["hello"]);
    const nonSafeMessageHash = ethers.keccak256(nonSafeMessage);

    // Encode message into Safe multisig format
    // Reuse public method from Safe CompatibilityFallbackHandler.sol to generate matching encoded message
    // https://github.com/safe-global/safe-smart-account/blob/6fde75d29c8b52d5ac0c93a6fb7631d434b64119/contracts/handler/CompatibilityFallbackHandler.sol#L36-L38
    // NOTE 1: need to sign data that is encoded with encodeMessageDataForSafe; but for verification need to pass original data (see below NOTE 2)
    const safeCallbackContract = new ethers.Contract(
      SAFE_CALLBACK_CONTRACT_ADDRESS,
      SAFE_CALLBACK_ABI,
      signer
    );
    const safeEncodedMessage =
      await safeCallbackContract.encodeMessageDataForSafe(
        EIP1271_SAFE_ADDRESS,
        nonSafeMessageHash
      );

    // Sign correctly encoded message compatible with Safe
    const safeMessageHash = ethers.keccak256(safeEncodedMessage);
    const signature = await signer.signMessage(
      ethers.getBytes(safeMessageHash)
    );

    // Shift v value such that Safe verifies signature using ETH prefixed message, see helper method prepareSafeEIP1271Signature
    const safeCompatibleEip1271Sig = prepareSafeEIP1271Signature(signature);

    // See: https://github.com/safe-global/safe-smart-account/blob/6fde75d29c8b52d5ac0c93a6fb7631d434b64119/contracts/Safe.sol#L281
    await eip1271Contract.checkNSignatures(
      ethers.getBytes(safeMessageHash),
      "0x",
      safeCompatibleEip1271Sig,
      1
    );
    // NOTE 2: nonSafeMessageHash needs to be passed here as encodeMessageDataForSafe() is called internally
    await eip1271Contract.isValidSignature(
      ethers.getBytes(nonSafeMessageHash),
      safeCompatibleEip1271Sig
    );
  });

  describe("EIP-1271 Signer Tests", function () {
    let router: Router;
    let escrowImpl: Escrow;
    let settlementToken: MockERC20;
    let underlyingToken: MockERC20;
    let mockOracle: MockOracle;
    let owner: any;
    let user1: any;
    let user2: any;
    let eip1271Maker: any;

    beforeEach(async function () {
      const contracts = await setupTestContracts();
      ({
        owner,
        user1,
        user2,
        settlementToken,
        underlyingToken,
        escrowImpl,
        router,
        mockOracle,
      } = contracts);

      // Deploy EIP1271Maker contract and set owner as signer
      const EIP1271Maker = await ethers.getContractFactory("EIP1271Maker");
      eip1271Maker = await EIP1271Maker.deploy(router.target, owner.address, [
        user1.address,
      ]);

      // Fund EIP1271Maker with settlement tokens
      await settlementToken
        .connect(owner)
        .mint(eip1271Maker.target, ethers.parseUnits("1000", 18));

      // Approve the router
      await eip1271Maker
        .connect(owner)
        .approve(router.target, settlementToken.target, ethers.MaxUint256);
    });

    it("should allow taking a quote using EIP1271Maker as the signer", async function () {
      // Prepare RFQ initialization with EIP1271Maker as the signer
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, chainId);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));

      // Assign the EIP1271Maker's address as the quote signer
      rfqInitialization.rfqQuote.eip1271Maker = eip1271Maker.target;
      rfqInitialization.rfqQuote.signature = signature;

      // Check msg hash
      const preview = await router.previewTakeQuote(
        rfqInitialization,
        ethers.ZeroAddress
      );
      expect(preview.msgHash).to.equal(payloadHash);

      // Toggle quote paused
      await eip1271Maker.togglePauseQuotes();

      // Check revert if quote paused
      await underlyingToken
        .connect(user2)
        .approve(router.target, ethers.MaxUint256);
      await expect(
        router
          .connect(user2)
          .takeQuote(user2.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");

      // Toggle quote paused
      await eip1271Maker.togglePauseQuotes();

      // Check user2 can take quote
      await underlyingToken
        .connect(user2)
        .approve(router.target, ethers.MaxUint256);
      await expect(
        router
          .connect(user2)
          .takeQuote(user2.address, rfqInitialization, ethers.ZeroAddress)
      ).to.emit(router, "TakeQuote");
    });

    it("should revert if invalid EIP1271 signer", async function () {
      // Prepare RFQ initialization with EIP1271Maker as the signer
      const rfqInitialization = await getRFQInitialization({
        underlyingTokenAddress: String(underlyingToken.target),
        settlementTokenAddress: String(settlementToken.target),
      });

      const payloadHash = rfqSignaturePayload(rfqInitialization, chainId);
      const signature = await owner.signMessage(ethers.getBytes(payloadHash));

      // Assign the EIP1271Maker's address as the quote signer
      rfqInitialization.rfqQuote.eip1271Maker = eip1271Maker.target;
      rfqInitialization.rfqQuote.signature = signature;

      // Check msg hash
      const preview = await router.previewTakeQuote(
        rfqInitialization,
        ethers.ZeroAddress
      );
      expect(preview.msgHash).to.equal(payloadHash);
      expect(preview.status).to.equal(
        DataTypes.RFQStatus.InvalidEIP1271Signature
      );

      // Check revert
      await underlyingToken
        .connect(user2)
        .approve(router.target, ethers.MaxUint256);
      await expect(
        router
          .connect(user2)
          .takeQuote(user2.address, rfqInitialization, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(router, "InvalidTakeQuote");
    });
  });

  describe("Simple Swap with EIP1271Maker as Maker", function () {
    let router: any;
    let settlementToken: any;
    let underlyingToken: any;
    let eip1271Maker: any;
    let owner: any;
    let user1: any;
    let user2: any;
    let swapQuote: any;
    const CHAIN_ID = 31337;
    const FUND_AMOUNT = ethers.parseUnits("1000", 18);

    beforeEach(async function () {
      // Set up contracts and users
      const contracts = await setupTestContracts();
      ({ owner, user1, user2, settlementToken, underlyingToken, router } =
        contracts);

      // Deploy EIP1271Maker and fund it with underlying tokens and approve
      const EIP1271Maker = await ethers.getContractFactory("EIP1271Maker");
      eip1271Maker = await EIP1271Maker.deploy(router.target, owner.address, [
        user1.address,
      ]);
      await underlyingToken
        .connect(owner)
        .mint(eip1271Maker.target, FUND_AMOUNT);
      await eip1271Maker
        .connect(owner)
        .approve(router.target, underlyingToken.target, ethers.MaxUint256);

      // Set up EIP1271Maker as maker for the swap
      const makerGiveAmount = ethers.parseUnits(
        "1",
        await underlyingToken.decimals()
      );
      const takerGiveAmount = ethers.parseUnits(
        "1",
        await settlementToken.decimals()
      );

      swapQuote = {
        takerGiveToken: String(settlementToken.target),
        takerGiveAmount,
        makerGiveToken: String(underlyingToken.target),
        makerGiveAmount,
        validUntil: (await getLatestTimestamp()) + 60 * 5, // 5 minutes from now
        signature: "",
        eip1271Maker: eip1271Maker.target,
      };

      // Generate payload hash and have eip1271Maker sign it
      const payloadHash = swapSignaturePayload(swapQuote, CHAIN_ID);
      const signature = await user1.signMessage(ethers.getBytes(payloadHash));
      swapQuote.signature = signature;

      // Mint tokens to user2 and approve
      await settlementToken.connect(user2).mint(user2.address, FUND_AMOUNT);
      await settlementToken
        .connect(user2)
        .approve(router.target, ethers.MaxUint256);
    });

    it("should revert when attempting to take an expired swap quote", async function () {
      // Expire the swap quote
      swapQuote.validUntil = 0;
      const expiredPayloadHash = swapSignaturePayload(swapQuote, CHAIN_ID);
      swapQuote.signature = await user1.signMessage(
        ethers.getBytes(expiredPayloadHash)
      );

      await expect(
        router.connect(user2).takeSwapQuote(user2.address, swapQuote)
      ).to.be.revertedWithCustomError(router, "SwapQuoteExpired");
    });

    it("should revert when attempting to take swap quote from invalid signer", async function () {
      // Expire the swap quote
      const expiredPayloadHash = swapSignaturePayload(swapQuote, CHAIN_ID);
      swapQuote.signature = await user2.signMessage(
        ethers.getBytes(expiredPayloadHash)
      );

      await expect(
        router.connect(user2).takeSwapQuote(user2.address, swapQuote)
      ).to.be.revertedWithCustomError(router, "InvalidEIP1271Signature");
    });

    it("should revert when attempting to take swap quote from EIP1271 maker", async function () {
      // Random non-EIP-1271 maker
      swapQuote.eip1271Maker = ethers.Wallet.createRandom().address;

      await expect(
        router.connect(user2).takeSwapQuote(user2.address, swapQuote)
      ).to.be.revertedWithCustomError(router, "InvalidEIP1271Signature");
    });

    it("should revert when attempting to take a swap quote while the contract is paused", async function () {
      const taker = user2;

      // Pause quotes
      await eip1271Maker.connect(owner).togglePauseQuotes();

      await expect(
        router.connect(taker).takeSwapQuote(taker.address, swapQuote)
      ).to.be.revertedWithCustomError(router, "SwapQuotePaused");

      // Unpause for subsequent tests
      await eip1271Maker.connect(owner).togglePauseQuotes();

      await expect(
        router.connect(taker).takeSwapQuote(taker.address, swapQuote)
      ).to.emit(router, "TakeSwapQuote");
    });

    it("should allow a successful swap of underlyingToken for settlementToken", async function () {
      const taker = user2;

      // Balance snapshots before swap
      const preBalances = {
        underlyingTokenTaker: await underlyingToken.balanceOf(taker.address),
        settlementTokenTaker: await settlementToken.balanceOf(taker.address),
      };

      await expect(
        router.connect(taker).takeSwapQuote(taker.address, swapQuote)
      ).to.emit(router, "TakeSwapQuote");

      // Balance snapshots after swap
      const postBalances = {
        underlyingTokenTaker: await underlyingToken.balanceOf(taker.address),
        settlementTokenTaker: await settlementToken.balanceOf(taker.address),
      };

      // Assertions on balances after the swap
      expect(
        postBalances.underlyingTokenTaker - preBalances.underlyingTokenTaker
      ).to.equal(swapQuote.makerGiveAmount);
      expect(
        preBalances.settlementTokenTaker - postBalances.settlementTokenTaker
      ).to.equal(swapQuote.takerGiveAmount);
    });

    it("should revert when attempting to take the same swap quote twice", async function () {
      const taker = user2;

      // First successful swap
      await expect(
        router.connect(taker).takeSwapQuote(taker.address, swapQuote)
      ).to.emit(router, "TakeSwapQuote");

      // Attempting to take the same swap quote again
      await expect(
        router.connect(taker).takeSwapQuote(taker.address, swapQuote)
      ).to.be.revertedWithCustomError(router, "SwapQuoteAlreadyUsed");
    });
  });
});
