import { expect } from "chai";
import { ethers } from "hardhat";
import {
  Router,
  Escrow,
  MockERC20,
  ChainlinkOracle,
  MockOracle,
} from "../typechain-types";
import { DataTypes } from "./DataTypes";
import { setupAuction } from "./testHelpers";

describe("ChainlinkOracle", function () {
  // Mainnet addresses
  const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const ETH_USD_ORACLE = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
  const USDC_USD_ORACLE = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
  
  // Large holder addresses for impersonation
  const USDC_WHALE = "0x7713974908Be4BEd47172370115e8b1219F4A5f0"; // Circle
  const WETH_WHALE = "0x2F0b23f53734252Bda2277357e97e1517d6B042A";

  let chainlinkOracle: ChainlinkOracle;
  let router: Router;
  let escrowImpl: Escrow;
  let owner: any;
  let user1: any;
  let user2: any;
  let usdc: any;
  let weth: any;

  // Transaction override settings
  const overrides = {
    maxFeePerGas: ethers.parseUnits("30", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
  };

  before(async function () {
    await ethers.provider.send("hardhat_reset", [
      {
        forking: {
          jsonRpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
          blockNumber: 19261000,
        },
      },
    ]);

    // Set hardhat's blockGasLimit and other mining parameters
    await ethers.provider.send("evm_setAutomine", [true]);
    await ethers.provider.send("evm_setIntervalMining", [0]);

    // Get USDC and WETH contract instances
    usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);
    weth = await ethers.getContractAt("IERC20", WETH_ADDRESS);

    // Impersonate whales and send tokens to test accounts
    await ethers.provider.send("hardhat_impersonateAccount", [USDC_WHALE]);
    await ethers.provider.send("hardhat_impersonateAccount", [WETH_WHALE]);

    const usdcWhale = await ethers.getSigner(USDC_WHALE);
    const wethWhale = await ethers.getSigner(WETH_WHALE);

    // Fund the whales with ETH for gas
    await ethers.provider.send("hardhat_setBalance", [
      USDC_WHALE,
      "0x56BC75E2D631000000000", // 100 ETH
    ]);
    await ethers.provider.send("hardhat_setBalance", [
      WETH_WHALE,
      "0x56BC75E2D631000000000", // 100 ETH
    ]);

    [owner, user1, user2] = await ethers.getSigners();

    await ethers.provider.send("hardhat_setBalance", [
        owner.address,
        "0x21E19E0C9BAB2400000000" // 10000 ETH
      ]);
      await ethers.provider.send("hardhat_setBalance", [
        user1.address,
        "0x21E19E0C9BAB24000000000" // 10000 ETH
      ]);
      await ethers.provider.send("hardhat_setBalance", [
        user2.address,
        "0x21E19E0C9BAB24000000000" // 10000 ETH
      ]);

    // Transfer tokens to test accounts with overrides
    await usdc.connect(usdcWhale).transfer(owner.address, 1000000000, overrides); // 1000 USDC
    await usdc.connect(usdcWhale).transfer(user1.address, 1000000000, overrides); // 1000 USDC
    await weth.connect(wethWhale).transfer(owner.address, ethers.parseEther("10"), overrides); // 10 WETH
    await weth.connect(wethWhale).transfer(user1.address, ethers.parseEther("10"), overrides); // 10 WETH

    // Stop impersonating
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [USDC_WHALE]);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [WETH_WHALE]);
  });

  beforeEach(async function () {
    // Deploy ChainlinkOracle with overrides
    const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
    chainlinkOracle = await ChainlinkOracle.deploy(
      [USDC_ADDRESS, WETH_ADDRESS],
      [USDC_USD_ORACLE, ETH_USD_ORACLE],
      ETH_USD_ORACLE,
      owner.address,
      WETH_ADDRESS,
      overrides
    );

    // Deploy Escrow implementation with overrides
    const Escrow = await ethers.getContractFactory("Escrow");
    escrowImpl = await Escrow.deploy(overrides);

    // Deploy Router contract with overrides
    const Router = await ethers.getContractFactory("Router");
    router = await Router.deploy(owner.address, escrowImpl.target, overrides);
  });

  describe("Constructor & Initialization", function () {
    it("should correctly set oracle mappings", async function () {
      const usdcOracleInfo = await chainlinkOracle.oracleInfos(USDC_ADDRESS);
      const wethOracleInfo = await chainlinkOracle.oracleInfos(WETH_ADDRESS);

      expect(usdcOracleInfo.oracleAddr).to.equal(USDC_USD_ORACLE);
      expect(usdcOracleInfo.decimals).to.equal(8); // USDC/USD oracle uses 8 decimals
      expect(wethOracleInfo.oracleAddr).to.equal(ETH_USD_ORACLE);
      expect(wethOracleInfo.decimals).to.equal(8); // ETH/USD oracle uses 8 decimals
    });

    it("should revert with invalid array lengths", async function () {
      const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
      await expect(
        ChainlinkOracle.deploy(
          [USDC_ADDRESS],
          [USDC_USD_ORACLE, ETH_USD_ORACLE],
          ETH_USD_ORACLE,
          owner.address,
          WETH_ADDRESS,
          overrides
        )
      ).to.be.revertedWithCustomError(chainlinkOracle, "InvalidArrayLength");
    });

    it("should revert with zero ETH/USD oracle address", async function () {
        const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
        await expect(
          ChainlinkOracle.deploy(
            [USDC_ADDRESS, WETH_ADDRESS],
            [USDC_USD_ORACLE, ETH_USD_ORACLE],
            ethers.ZeroAddress,
            owner.address,
            WETH_ADDRESS,
            overrides
          )
        ).to.be.revertedWithCustomError(chainlinkOracle, "InvalidAddress");
      });
    
      it("should revert with zero token address", async function () {
        const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
        await expect(
          ChainlinkOracle.deploy(
            [ethers.ZeroAddress, WETH_ADDRESS],
            [USDC_USD_ORACLE, ETH_USD_ORACLE],
            ETH_USD_ORACLE,
            owner.address,
            WETH_ADDRESS,
            overrides
          )
        ).to.be.revertedWithCustomError(chainlinkOracle, "InvalidAddress");
      });
    
      it("should revert with zero oracle address", async function () {
        const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
        await expect(
          ChainlinkOracle.deploy(
            [USDC_ADDRESS, WETH_ADDRESS],
            [ethers.ZeroAddress, ETH_USD_ORACLE],
            ETH_USD_ORACLE,
            owner.address,
            WETH_ADDRESS,
            overrides
          )
        ).to.be.revertedWithCustomError(chainlinkOracle, "InvalidAddress");
      });
    
      it("should revert with empty arrays", async function () {
        const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
        await expect(
          ChainlinkOracle.deploy(
            [],
            [],
            ETH_USD_ORACLE,
            owner.address,
            WETH_ADDRESS,
            overrides
          )
        ).to.be.revertedWithCustomError(chainlinkOracle, "InvalidArrayLength");
      });
    
      it("should revert with invalid oracle decimals", async function () {
        const MockChainlinkAggregator = await ethers.getContractFactory("MockChainlinkAggregator");
        const mockOracle = await MockChainlinkAggregator.deploy(6); // Deploy with 6 decimals instead of 8 or 18
    
        await expect(
          chainlinkOracle.connect(owner).addOracleMapping(
            [ethers.Wallet.createRandom().address],
            [mockOracle.target],
            overrides
          )
        ).to.be.revertedWithCustomError(chainlinkOracle, "InvalidOracleDecimals");
      });

      it("should revert when token and oracle arrays have different lengths", async function () {
        const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
    
        const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
        await expect(
          ChainlinkOracle.deploy(
            [USDC_ADDRESS, WETH_ADDRESS, DAI_ADDRESS], // 3 tokens
            [USDC_USD_ORACLE, ETH_USD_ORACLE], // Only 2 oracles
            ETH_USD_ORACLE,
            owner.address,
            WETH_ADDRESS,
            overrides
          )
        ).to.be.revertedWithCustomError(chainlinkOracle, "InvalidArrayLength");
      });
  });

  describe("Price Fetching", function () {
    it("should return correct WETH/USDC price", async function () {
      const price = await chainlinkOracle.getPrice(
        WETH_ADDRESS,
        USDC_ADDRESS,
        []
      );
      
      // Price should be in the reasonable range (1 ETH = 2000-5000 USDC)
      expect(price).to.be.gt(ethers.parseUnits("2000", 6));
      expect(price).to.be.lt(ethers.parseUnits("5000", 6));
    });

    it("should return correct USDC/WETH price", async function () {
      const price = await chainlinkOracle.getPrice(
        USDC_ADDRESS,
        WETH_ADDRESS,
        []
      );
      
      // Price should be in the reasonable range (1 USDC = 0.0002-0.0005 ETH)
      expect(price).to.be.gt(ethers.parseEther("0.0002"));
      expect(price).to.be.lt(ethers.parseEther("0.0005"));
    });

    it("should revert for non-existent oracle", async function () {
      const randomAddress = ethers.Wallet.createRandom().address;
      await expect(
        chainlinkOracle.getPrice(randomAddress, USDC_ADDRESS, [])
      ).to.be.revertedWithCustomError(chainlinkOracle, "NoOracle");
    });

    it("should return 1e18 when getting price of WETH in WETH", async function () {
        const price = await chainlinkOracle.getPrice(
          WETH_ADDRESS,
          WETH_ADDRESS,
          []
        );
        
        expect(price).to.equal(ethers.parseEther("1")); // Should be exactly 1e18
      });
    
      it("should correctly handle WETH as quote token", async function () {
        // Test USDC price in WETH
        const price = await chainlinkOracle.getPrice(
          USDC_ADDRESS,
          WETH_ADDRESS,
          []
        );
    
        // 1 USDC should be worth a small fraction of ETH (around 0.0002-0.0005 ETH)
        expect(price).to.be.gt(ethers.parseEther("0.0002"));
        expect(price).to.be.lt(ethers.parseEther("0.0005"));
      });
    
      it("should correctly handle WETH as base token", async function () {
        // Test WETH price in USDC
        const price = await chainlinkOracle.getPrice(
          WETH_ADDRESS,
          USDC_ADDRESS,
          []
        );
    
        expect(price).to.be.gt(ethers.parseUnits("2000", 6));
        expect(price).to.be.lt(ethers.parseUnits("5000", 6));
      });

      it("should correctly fetch DAI/USDC price through USD oracles", async function () {
        const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
        const DAI_USD_ORACLE = "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9";
    
        // First add DAI oracle mapping
        await chainlinkOracle.connect(owner).addOracleMapping(
          [DAI_ADDRESS],
          [DAI_USD_ORACLE],
          overrides
        );
    
        // Get DAI price in USDC
        const price = await chainlinkOracle.getPrice(
          DAI_ADDRESS,
          USDC_ADDRESS,
          []
        );
    
        // DAI should be roughly equal to 1 USDC (with some small deviation)
        // Let's check it's within 0.95-1.05 USDC
        expect(price).to.be.gt(ethers.parseUnits("0.95", 6));
        expect(price).to.be.lt(ethers.parseUnits("1.05", 6));
    
        // Verify we can also get the price in the other direction (USDC/DAI)
        const reversePrice = await chainlinkOracle.getPrice(
          USDC_ADDRESS,
          DAI_ADDRESS,
          []
        );
    
        // Should also be roughly 1 (in DAI decimals)
        expect(reversePrice).to.be.gt(ethers.parseUnits("0.95", 18));
        expect(reversePrice).to.be.lt(ethers.parseUnits("1.05", 18));
    
        // Get DAI price in WETH (should work through USD oracles)
        const daiEthPrice = await chainlinkOracle.getPrice(
          DAI_ADDRESS,
          WETH_ADDRESS,
          []
        );
    
        // 1 DAI should be worth approximately the same as 1 USDC in ETH
        const usdcEthPrice = await chainlinkOracle.getPrice(
          USDC_ADDRESS,
          WETH_ADDRESS,
          []
        );
    
        // The ratio between DAI/ETH and USDC/ETH should be close to 1 (within 5%)
        const ratio = (daiEthPrice * BigInt(1000000)) / usdcEthPrice;
        expect(ratio).to.be.gt(950000); // 0.95 with 6 decimal precision
        expect(ratio).to.be.lt(1050000); // 1.05 with 6 decimal precision
      });
    
      it("should revert when trying to get price with non-existent token/oracle pair", async function () {
        const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
        // Try to get DAI price without adding its oracle first
        await expect(
          chainlinkOracle.getPrice(
            DAI_ADDRESS,
            USDC_ADDRESS,
            []
          )
        ).to.be.revertedWithCustomError(chainlinkOracle, "NoOracle");
      });
  });

  describe("Oracle Integration with Auction", function () {
    it("should successfully create and bid on auction using oracle prices", async function () {
        // First approve underlying token transfer
        await weth.connect(owner).approve(router.target, ethers.parseEther("100"), overrides);
      
        const { auctionInitialization } = await setupAuction({
          underlyingTokenAddress: WETH_ADDRESS,
          settlementTokenAddress: USDC_ADDRESS,
          oracleAddress: String(chainlinkOracle.target),
          router,
          owner,
          notionalAmount: ethers.parseEther("1"),
          relStrike: ethers.parseEther("1.2"),
          tenor: 86400 * 30,
          earliestExerciseTenor: 86400 * 7,
          minSpot: ethers.parseUnits("1000", 6),
          maxSpot: ethers.parseUnits("5000", 6),
        }, false);
      
        // Create auction
        await router.connect(owner).createAuction(owner.address, auctionInitialization, overrides);
      
        // Get the escrow address
        const escrowAddress = (await router.getEscrows(0, 1))[0];
      
        // Approve USDC for bid
        await usdc.connect(user1).approve(router.target, ethers.parseUnits("10000", 6), overrides);
      
        // Place bid
        const refSpot = ethers.parseUnits("4000", 6); // $4000 per ETH
        await expect(
          router.connect(user1).bidOnAuction(
            escrowAddress,
            user1.address,
            ethers.parseEther("0.1"), // 10% premium
            refSpot,
            [], // No additional oracle data needed for Chainlink
            ethers.ZeroAddress,
            overrides
          )
        ).to.emit(router, "BidOnAuction");
      
        // Verify option was minted
        const escrow = await ethers.getContractAt("Escrow", escrowAddress);
        expect(await escrow.optionMinted()).to.be.true;
      });
  });

  describe("Adding Oracle Mappings", function () {
    it("should allow owner to add new oracle mappings", async function () {
        const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
        const DAI_USD_ORACLE = "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9";
      
        await expect(
          chainlinkOracle.connect(owner).addOracleMapping(
            [DAI_ADDRESS],
            [DAI_USD_ORACLE],
            overrides
          )
        ).to.emit(chainlinkOracle, "OracleMappingAdded")
        .withArgs(DAI_ADDRESS, DAI_USD_ORACLE);
      
        // Verify the mapping was set correctly
        const daiOracleInfo = await chainlinkOracle.oracleInfos(DAI_ADDRESS);
        expect(daiOracleInfo.oracleAddr).to.equal(DAI_USD_ORACLE);
        expect(daiOracleInfo.decimals).to.equal(8); // DAI/USD oracle uses 8 decimals
      });

    it("should revert when non-owner tries to add mappings", async function () {
      await expect(
        chainlinkOracle.connect(user1).addOracleMapping(
          [ethers.Wallet.createRandom().address],
          [ethers.Wallet.createRandom().address],
          overrides
        )
      ).to.be.revertedWithCustomError(chainlinkOracle, "OwnableUnauthorizedAccount");
    });

    it("should revert when adding mapping for token that already has oracle", async function () {
      await expect(
        chainlinkOracle.connect(owner).addOracleMapping(
          [USDC_ADDRESS],
          [USDC_USD_ORACLE],
          overrides
        )
      ).to.be.revertedWithCustomError(chainlinkOracle, "OracleAlreadySet");
    });
  });
});