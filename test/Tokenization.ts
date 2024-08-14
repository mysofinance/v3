const { expect } = require("chai");
import { ethers } from "hardhat";
import {
  OTokenImpl,
  BTokenImpl,
  TokenizationFactory,
} from "../typechain-types";

async function increaseTime(provider: any, seconds: any) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
  const newBlockTime = (await provider.getBlock("latest")).timestamp;
  return newBlockTime;
}

describe("oToken Contracts", function () {
  let provider: any;

  let deployer: any;
  let user1: any;
  let user2: any;
  let oTokenImpl: OTokenImpl;
  let bTokenImpl: BTokenImpl;
  let tokenizationFactory: TokenizationFactory;
  let usdc: any;
  let token: any;

  beforeEach(async function () {
    [deployer, user1, user2] = await ethers.getSigners();
    provider = deployer.provider;

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USDC", "USDC", 6);
    token = await MockERC20.deploy("XYZ", "XYZ", 18);

    const OTokenImpl = await ethers.getContractFactory("OTokenImpl");
    oTokenImpl = await OTokenImpl.deploy();
    expect(await oTokenImpl.name()).to.be.equal("");
    expect(await oTokenImpl.symbol()).to.be.equal("");

    const BTokenImpl = await ethers.getContractFactory("BTokenImpl");
    bTokenImpl = await BTokenImpl.deploy();
    expect(await bTokenImpl.name()).to.be.equal("");
    expect(await bTokenImpl.symbol()).to.be.equal("");

    const TokenizationFactory = await ethers.getContractFactory(
      "TokenizationFactory",
    );
    tokenizationFactory = await TokenizationFactory.deploy(
      deployer.address,
      oTokenImpl.target,
      bTokenImpl.target,
      ethers.ZeroAddress,
    );
  });

  describe("Tests", function () {
    it("Should handle initialization correctly", async function () {
      const oTokenTo = user1.address;
      const bTokenTo = user2.address;
      const amount = ethers.parseEther("1");

      await token.approve(tokenizationFactory.target, amount);

      let currentBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      const mintConfig = {
        version: 0,
        underlying: token.target,
        settlementToken: usdc.target,
        strike: ethers.parseUnits("100", 6),
        expiry: currentBlockTimestamp + thirtyDaysInSeconds,
        earliestExercise: 0,
        remintable: true,
        allowedOTokenCalls: [],
        hasERC20Votes: false,
        votingDelegate: ethers.ZeroAddress,
        delegateRegistry: ethers.ZeroAddress,
        spaceId: ethers.encodeBytes32String(""),
        transferrable: true,
        reverseExercisable: false,
      };

      let invalidMintConfig1 = {
        ...mintConfig,
        strike: 0,
      };
      await expect(
        tokenizationFactory
          .connect(deployer)
          .mint(oTokenTo, bTokenTo, amount, invalidMintConfig1),
      ).to.be.revertedWithCustomError(
        oTokenImpl,
        "InvalidOTokenInitialization",
      );

      let invalidMintConfig2 = {
        ...mintConfig,
        expiry: currentBlockTimestamp - 10,
      };
      await expect(
        tokenizationFactory
          .connect(deployer)
          .mint(oTokenTo, bTokenTo, amount, invalidMintConfig2),
      ).to.be.revertedWithCustomError(
        oTokenImpl,
        "InvalidOTokenInitialization",
      );

      let invalidMintConfig3 = {
        ...mintConfig,
        earliestExercise: currentBlockTimestamp + thirtyDaysInSeconds + 1,
      };
      await expect(
        tokenizationFactory
          .connect(deployer)
          .mint(oTokenTo, bTokenTo, amount, invalidMintConfig3),
      ).to.be.revertedWithCustomError(
        oTokenImpl,
        "InvalidOTokenInitialization",
      );

      let invalidMintConfig4 = {
        ...mintConfig,
        underlying: ethers.ZeroAddress,
      };
      await expect(
        tokenizationFactory
          .connect(deployer)
          .mint(oTokenTo, bTokenTo, amount, invalidMintConfig4),
      ).to.be.revertedWithCustomError(tokenizationFactory, "InvalidMint");

      let invalidMintConfig5 = {
        ...mintConfig,
        settlementToken: ethers.ZeroAddress,
      };
      await expect(
        tokenizationFactory
          .connect(deployer)
          .mint(oTokenTo, bTokenTo, amount, invalidMintConfig5),
      ).to.be.revertedWithCustomError(tokenizationFactory, "InvalidMint");
    });

    it("Should handle minting correctly", async function () {
      const oTokenTo = user1.address;
      const bTokenTo = user2.address;
      const amount = ethers.parseEther("1");

      await token.approve(tokenizationFactory.target, amount);

      let currentBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      const mintConfig = {
        version: 0,
        underlying: token.target,
        settlementToken: usdc.target,
        strike: ethers.parseUnits("100", 6),
        expiry: currentBlockTimestamp + thirtyDaysInSeconds,
        earliestExercise: 0,
        remintable: true,
        allowedOTokenCalls: [],
        hasERC20Votes: false,
        votingDelegate: ethers.ZeroAddress,
        delegateRegistry: ethers.ZeroAddress,
        spaceId: ethers.encodeBytes32String(""),
        transferrable: true,
        reverseExercisable: false,
      };
      await tokenizationFactory
        .connect(deployer)
        .mint(oTokenTo, bTokenTo, amount, mintConfig);

      const tokens = await tokenizationFactory.getTokens(0, 0, 1);
      const mintedOToken: any = await oTokenImpl.attach(tokens[0][0]);
      const mintedBToken: any = await bTokenImpl.attach(tokens[1][0]);

      // check mint config properly set
      expect(await mintedOToken.name()).to.be.equal("oToken XYZ");
      expect(await mintedOToken.symbol()).to.be.equal("oXYZ");
      expect(await mintedBToken.name()).to.be.equal("bToken XYZ");
      expect(await mintedBToken.symbol()).to.be.equal("bXYZ");

      expect(await mintedOToken.factory()).to.be.equal(
        tokenizationFactory.target,
      );
      expect(await mintedBToken.factory()).to.be.equal(
        tokenizationFactory.target,
      );
      expect(await mintedOToken.bToken()).to.be.equal(mintedBToken);
      expect(await mintedBToken.oToken()).to.be.equal(mintedOToken);
      expect(await mintedOToken.underlying()).to.be.equal(
        mintConfig.underlying,
      );
      expect(await mintedOToken.settlementToken()).to.be.equal(
        mintConfig.settlementToken,
      );
      expect(await mintedOToken.strike()).to.be.equal(mintConfig.strike);
      expect(await mintedOToken.expiry()).to.be.equal(mintConfig.expiry);
      expect(await mintedOToken.earliestExercise()).to.be.equal(
        mintConfig.earliestExercise,
      );
      expect(await mintedOToken.transferrable()).to.be.equal(
        mintConfig.transferrable,
      );
      expect(await mintedOToken.reverseExercisable()).to.be.equal(
        mintConfig.reverseExercisable,
      );

      // check transferability
      await mintedOToken.connect(user1).transfer(user1.address, 1);
      await mintedOToken.connect(user1).approve(user2.address, 1);
      await mintedOToken
        .connect(user2)
        .transferFrom(user1.address, user2.address, 1);

      // partial exercise
      const partialExercise = amount / BigInt(10);
      const { settlementAmount, settlementFee, settlementFeesReceiver } =
        await mintedOToken.getSettlementAmount(partialExercise);
      const totalSettlementAmount = settlementAmount + settlementFee;
      await usdc.mint(user1.address, totalSettlementAmount);
      await usdc
        .connect(user1)
        .approve(mintedOToken.target, totalSettlementAmount);

      await increaseTime(provider, thirtyDaysInSeconds - 30);
      await mintedOToken
        .connect(user1)
        .exercise(user1.address, partialExercise);

      // check redeemability
      await expect(
        mintedBToken.connect(user2).redeem(user2.address),
      ).to.be.revertedWithCustomError(mintedBToken, "InvalidTime");
      currentBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      await increaseTime(
        provider,
        mintConfig.expiry - currentBlockTimestamp + 1,
      );

      const {
        proRataUnderlying,
        proRataSettlement,
        underlying,
        settlementToken,
        userBal,
      } = await mintedBToken.redeemableAmounts(user2.address);
      expect(proRataUnderlying).to.be.equal(amount - partialExercise);
      expect(proRataSettlement).to.be.equal(settlementAmount);
      expect(underlying).to.be.equal(mintConfig.underlying);
      expect(settlementToken).to.be.equal(mintConfig.settlementToken);
      expect(userBal).to.be.equal(await mintedBToken.balanceOf(user2.address));
      await mintedBToken.connect(user2).redeem(user2.address);
    });

    it("Should handle exercise correctly (1/2)", async function () {
      const oTokenTo = user1.address;
      const bTokenTo = deployer.address;
      const amount = ethers.parseEther("1");

      await token.approve(tokenizationFactory.target, amount);

      let currentBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      const mintConfig = {
        version: 0,
        underlying: token.target,
        settlementToken: usdc.target,
        strike: ethers.parseUnits("100", 6),
        expiry: currentBlockTimestamp + thirtyDaysInSeconds,
        earliestExercise: 0,
        remintable: true,
        allowedOTokenCalls: [],
        hasERC20Votes: false,
        votingDelegate: ethers.ZeroAddress,
        delegateRegistry: ethers.ZeroAddress,
        spaceId: ethers.encodeBytes32String(""),
        transferrable: true,
        reverseExercisable: false,
      };
      await tokenizationFactory.mint(oTokenTo, bTokenTo, amount, mintConfig);

      const tokens = await tokenizationFactory.getTokens(0, 0, 1);
      const mintedOToken: any = await oTokenImpl.attach(tokens[0][0]);

      // Exercise the oToken
      const { settlementAmount, settlementFee, settlementFeesReceiver } =
        await mintedOToken.getSettlementAmount(amount);
      const totalSettlementAmount = settlementAmount + settlementFee;
      await usdc.mint(user1.address, totalSettlementAmount);
      await usdc
        .connect(user1)
        .approve(mintedOToken.target, totalSettlementAmount);

      await increaseTime(provider, thirtyDaysInSeconds - 30);
      await expect(
        mintedOToken.connect(user1).exercise(user1.address, 0),
      ).to.be.revertedWithCustomError(mintedOToken, "InvalidAmount");
      await expect(
        mintedOToken.connect(user1).exercise(user1.address, 1),
      ).to.be.revertedWithCustomError(mintedOToken, "ZeroSettlementAmount");
      await mintedOToken.connect(user1).exercise(user1.address, amount);
      await expect(
        mintedOToken.connect(user2).reverseExercise(user1.address, amount),
      ).to.be.revertedWithCustomError(mintedOToken, "NotReverseExercisable");

      expect(await usdc.balanceOf(user1.address)).to.be.equal(0);
      expect(await token.balanceOf(user1.address)).to.be.equal(amount);

      currentBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      await increaseTime(
        provider,
        mintConfig.expiry - currentBlockTimestamp + 1,
      );
      await expect(
        mintedOToken.connect(user1).exercise(user1.address, 1),
      ).to.be.revertedWithCustomError(mintedOToken, "InvalidTime");
    });

    it("Should handle exercise correctly (2/2)", async function () {
      const oTokenTo = user1.address;
      const bTokenTo = deployer.address;
      const amount = ethers.parseEther("1");

      await token.approve(tokenizationFactory.target, amount);

      let currentBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      const mintConfig = {
        version: 0,
        underlying: token.target,
        settlementToken: usdc.target,
        strike: ethers.parseUnits("100", 6),
        expiry: currentBlockTimestamp + thirtyDaysInSeconds,
        earliestExercise: currentBlockTimestamp + 24 * 60 * 60,
        remintable: true,
        allowedOTokenCalls: [],
        hasERC20Votes: false,
        votingDelegate: ethers.ZeroAddress,
        delegateRegistry: ethers.ZeroAddress,
        spaceId: ethers.encodeBytes32String(""),
        transferrable: true,
        reverseExercisable: false,
      };
      await tokenizationFactory.mint(oTokenTo, bTokenTo, amount, mintConfig);

      const tokens = await tokenizationFactory.getTokens(0, 0, 1);
      const mintedOToken: any = await oTokenImpl.attach(tokens[0][0]);

      // Exercise the oToken
      const { settlementAmount, settlementFee, settlementFeesReceiver } =
        await mintedOToken.getSettlementAmount(amount);
      const totalSettlementAmount = settlementAmount + settlementFee;
      await usdc.mint(user1.address, totalSettlementAmount);
      await usdc
        .connect(user1)
        .approve(mintedOToken.target, totalSettlementAmount);

      await expect(
        mintedOToken.connect(user1).exercise(user1.address, amount),
      ).to.be.revertedWithCustomError(mintedOToken, "InvalidTime");
    });

    it("Should handle reverse exercise correctly", async function () {
      const oTokenTo = user1.address;
      const bTokenTo = deployer.address;
      const amount = ethers.parseEther("1");

      await token.approve(tokenizationFactory.target, amount);

      let currentBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      const mintConfig = {
        version: 0,
        underlying: token.target,
        settlementToken: usdc.target,
        strike: ethers.parseUnits("100", 6),
        expiry: currentBlockTimestamp + thirtyDaysInSeconds,
        earliestExercise: 0,
        remintable: true,
        allowedOTokenCalls: [],
        hasERC20Votes: false,
        votingDelegate: ethers.ZeroAddress,
        delegateRegistry: ethers.ZeroAddress,
        spaceId: ethers.encodeBytes32String(""),
        transferrable: true,
        reverseExercisable: true,
      };
      await tokenizationFactory.mint(oTokenTo, bTokenTo, amount, mintConfig);

      const tokens = await tokenizationFactory.getTokens(0, 0, 1);
      const mintedOToken: any = await oTokenImpl.attach(tokens[0][0]);

      // Exercise the oToken
      const { settlementAmount, settlementFee, settlementFeesReceiver } =
        await mintedOToken.getSettlementAmount(amount);
      const totalSettlementAmount = settlementAmount + settlementFee;
      await usdc.mint(user1.address, totalSettlementAmount);
      await usdc
        .connect(user1)
        .approve(mintedOToken.target, totalSettlementAmount);

      await increaseTime(provider, thirtyDaysInSeconds - 30);
      await mintedOToken.connect(user1).exercise(user1.address, amount);

      expect(await usdc.balanceOf(user1.address)).to.be.equal(0);
      expect(await token.balanceOf(user1.address)).to.be.equal(amount);

      // Reverse Exercise
      await token.connect(user1).approve(mintedOToken.target, amount);
      await expect(
        mintedOToken.connect(user1).reverseExercise(user1.address, 0),
      ).to.be.revertedWithCustomError(mintedOToken, "InvalidAmount");
      await expect(
        mintedOToken.connect(user2).reverseExercise(user1.address, amount),
      ).to.be.revertedWithCustomError(mintedOToken, "AmountTooLarge");
      await expect(
        mintedOToken.connect(user1).reverseExercise(user1.address, 1),
      ).to.be.revertedWithCustomError(mintedOToken, "ZeroSettlementAmount");
      await mintedOToken.connect(user1).reverseExercise(user1.address, amount);

      expect(await usdc.balanceOf(user1.address)).to.be.equal(
        settlementAmount - settlementFee,
      );
      expect(await token.balanceOf(user1.address)).to.be.equal(0);

      currentBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      await increaseTime(
        provider,
        mintConfig.expiry - currentBlockTimestamp + 1,
      );
      await expect(
        mintedOToken.connect(user1).reverseExercise(user1.address, amount),
      ).to.be.revertedWithCustomError(mintedOToken, "InvalidTime");
    });

    it("Should handle non-transferable token restriction", async function () {
      const oTokenTo = user1.address;
      const bTokenTo = deployer.address;
      const amount = ethers.parseEther("1");

      await token.approve(tokenizationFactory.target, amount);

      const currentBlockTimestamp = (await provider.getBlock("latest"))
        .timestamp;
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      const mintConfig = {
        version: 0,
        underlying: token.target,
        settlementToken: usdc.target,
        strike: ethers.parseUnits("100", 6),
        expiry: currentBlockTimestamp + thirtyDaysInSeconds,
        earliestExercise: 0,
        remintable: true,
        allowedOTokenCalls: [],
        hasERC20Votes: false,
        votingDelegate: ethers.ZeroAddress,
        delegateRegistry: ethers.ZeroAddress,
        spaceId: ethers.encodeBytes32String(""),
        transferrable: false,
        reverseExercisable: false,
      };
      await tokenizationFactory.mint(oTokenTo, bTokenTo, amount, mintConfig);

      const tokens = await tokenizationFactory.getTokens(0, 0, 1);
      const mintedOToken: any = await oTokenImpl.attach(tokens[0][0]);

      await expect(
        mintedOToken.connect(deployer).transfer(user1.address, amount),
      ).to.be.revertedWithCustomError(mintedOToken, "NonTransferrable");
      await expect(
        mintedOToken
          .connect(deployer)
          .transferFrom(deployer.address, user1.address, amount),
      ).to.be.revertedWithCustomError(mintedOToken, "NonTransferrable");
    });

    it("Should execute allowed calls correctly", async function () {
      const oTokenTo = deployer.address;
      const bTokenTo = deployer.address;
      const amount = ethers.parseEther("1");

      await token.approve(tokenizationFactory.target, amount);

      const currentBlockTimestamp = (await provider.getBlock("latest"))
        .timestamp;
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      const allowedCalls = [
        {
          allowedTarget: token.target,
          allowedMethod: "transfer(address,uint256)",
          allowedCaller: deployer.address,
        },
      ];
      const mintConfig = {
        version: 0,
        underlying: token.target,
        settlementToken: usdc.target,
        strike: ethers.parseUnits("100", 6),
        expiry: currentBlockTimestamp + thirtyDaysInSeconds,
        earliestExercise: 0,
        remintable: true,
        allowedOTokenCalls: allowedCalls,
        hasERC20Votes: false,
        votingDelegate: ethers.ZeroAddress,
        delegateRegistry: ethers.ZeroAddress,
        spaceId: ethers.encodeBytes32String(""),
        transferrable: true,
        reverseExercisable: false,
      };
      await tokenizationFactory.mint(oTokenTo, bTokenTo, amount, mintConfig);

      const tokens = await tokenizationFactory.getTokens(0, 0, 1);
      const mintedOToken: any = await oTokenImpl.attach(tokens[0][0]);

      const abi = ethers.AbiCoder.defaultAbiCoder();

      const preTokenBal = await token.balanceOf(user1.address);
      await token.mint(mintedOToken.target, 1);
      await mintedOToken
        .connect(deployer)
        .call(
          token.target,
          "transfer(address,uint256)",
          abi.encode(["address", "uint256"], [user1.address, 1]),
        );
      const postTokenBal = await token.balanceOf(user1.address);
      expect(postTokenBal - preTokenBal).to.be.equal(1);
      await expect(
        mintedOToken
          .connect(user1)
          .call(
            token.target,
            "transfer(address,uint256)",
            abi.encode(["address", "uint256"], [user1.address, 1]),
          ),
      ).to.be.revertedWithCustomError(mintedOToken, "Unauthorized");
    });

    it("Should handle access correctly", async function () {
      const oTokenTo = deployer.address;
      const bTokenTo = deployer.address;
      const amount = ethers.parseEther("1");

      await token.approve(tokenizationFactory.target, amount);

      const currentBlockTimestamp = (await provider.getBlock("latest"))
        .timestamp;
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      const mintConfig = {
        version: 0,
        underlying: token.target,
        settlementToken: usdc.target,
        strike: ethers.parseUnits("100", 6),
        expiry: currentBlockTimestamp + thirtyDaysInSeconds,
        earliestExercise: 0,
        remintable: true,
        allowedOTokenCalls: [],
        hasERC20Votes: false,
        votingDelegate: ethers.ZeroAddress,
        delegateRegistry: ethers.ZeroAddress,
        spaceId: ethers.encodeBytes32String(""),
        transferrable: true,
        reverseExercisable: false,
      };
      await tokenizationFactory.mint(oTokenTo, bTokenTo, amount, mintConfig);

      const tokens = await tokenizationFactory.getTokens(0, 0, 1);
      const mintedOToken: any = await oTokenImpl.attach(tokens[0][0]);
      const mintedBToken: any = await bTokenImpl.attach(tokens[1][0]);

      await expect(
        mintedOToken.forwardUnderlying(user1.address, amount),
      ).to.be.revertedWithCustomError(mintedOToken, "Unauthorized");
      await expect(
        mintedOToken.delegateVotes(
          true,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          ethers.encodeBytes32String(""),
        ),
      ).to.be.revertedWithCustomError(mintedOToken, "Unauthorized");
      await expect(
        mintedOToken.mint(user1.address, amount),
      ).to.be.revertedWithCustomError(mintedOToken, "Unauthorized");
      await expect(
        mintedBToken.forwardSettlement(user1.address, amount),
      ).to.be.revertedWithCustomError(mintedOToken, "Unauthorized");
      await expect(
        mintedBToken.mint(user1.address, amount),
      ).to.be.revertedWithCustomError(mintedOToken, "Unauthorized");
      await expect(
        mintedBToken.burn(user1.address, amount),
      ).to.be.revertedWithCustomError(mintedOToken, "Unauthorized");
    });

    it("Should reverse mint correctly", async function () {
      const oTokenTo = user1.address;
      const bTokenTo = user1.address;
      const amount = ethers.parseEther("1");

      await token.approve(tokenizationFactory.target, amount);

      let currentBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      const mintConfig = {
        version: 0,
        underlying: token.target,
        settlementToken: usdc.target,
        strike: ethers.parseUnits("100", 6),
        expiry: currentBlockTimestamp + thirtyDaysInSeconds,
        earliestExercise: 0,
        remintable: true,
        allowedOTokenCalls: [],
        hasERC20Votes: false,
        votingDelegate: ethers.ZeroAddress,
        delegateRegistry: ethers.ZeroAddress,
        spaceId: ethers.encodeBytes32String(""),
        transferrable: true,
        reverseExercisable: true,
      };
      await tokenizationFactory.mint(oTokenTo, bTokenTo, amount, mintConfig);

      const tokens = await tokenizationFactory.getTokens(0, 0, 1);
      const mintedOToken: any = await oTokenImpl.attach(tokens[0][0]);

      await expect(
        mintedOToken.connect(user1).reverseMint(user1.address, 0),
      ).to.be.revertedWithCustomError(mintedOToken, "InvalidAmount");
      await mintedOToken.connect(user1).reverseMint(user1.address, amount);
      expect(await token.balanceOf(user1.address)).to.be.equal(amount);
      expect(await mintedOToken.balanceOf(user1.address)).to.be.equal(0);

      currentBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      await increaseTime(
        provider,
        mintConfig.expiry - currentBlockTimestamp + 1,
      );
      await expect(
        mintedOToken.connect(user1).reverseMint(user1.address, 0),
      ).to.be.revertedWithCustomError(mintedOToken, "InvalidTime");
    });
  });
});
