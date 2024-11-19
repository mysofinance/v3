const { expect } = require("chai");
import { ethers } from "hardhat";
import { getDefaultOptionInfo } from "./helpers";
import { TestInitializableERC20 } from "../typechain-types";
import { DataTypes } from "./DataTypes";

describe("Test Initializable ERC20", function () {
  describe("Start Auction", function () {
    it("should allow initializating only once", async function () {
      const [owner] = await ethers.getSigners();
      const provider = owner.provider;

      // Deploy mock ERC20 tokens
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const settlementToken = await MockERC20.deploy(
        "Settlement Token",
        "SETT",
        6
      );
      const underlyingToken = await MockERC20.deploy(
        "Underlying Token",
        "UND",
        18
      );

      // Deploy bad Escrow implementation
      const Escrow = await ethers.getContractFactory("TestInitializableERC20");
      const escrowImpl = await Escrow.deploy();

      // Deploy Router contract
      const Router = await ethers.getContractFactory("Router");
      const router = await Router.deploy(owner.address, escrowImpl.target);

      // Mint tokens for users
      await settlementToken.mint(owner.address, ethers.parseEther("1000"));
      await underlyingToken.mint(owner.address, ethers.parseEther("1000"));

      const optionInfo = await getDefaultOptionInfo(
        String(underlyingToken.target),
        String(settlementToken.target),
        ethers.parseUnits("1", await settlementToken.decimals())
      );

      // Approve
      await underlyingToken
        .connect(owner)
        .approve(router.target, optionInfo.notional);

      // Mint the option
      await expect(
        router.connect(owner).mintOption(
          owner.address,
          owner.address,
          optionInfo,
          {
            name: "Option Name",
            symbol: "Option Symbol",
          } as DataTypes.OptionNaming,
          ethers.ZeroAddress
        )
      ).to.emit(router, "MintOption");

      const escrowAddrs = await router.getEscrows(0, 1);
      const EscrowImpl = await ethers.getContractFactory(
        "TestInitializableERC20"
      );
      const escrow = EscrowImpl.attach(
        escrowAddrs[0]
      ) as TestInitializableERC20;

      // Check re-initializing fails
      await expect(
        escrow.anotherInitialize("another name", "another symbol", 0)
      ).to.be.revertedWithCustomError(escrowImpl, "AlreadyInitialized");
    });
  });
});
