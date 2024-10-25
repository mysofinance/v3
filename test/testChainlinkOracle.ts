import { chainlink } from "../typechain-types";

const { expect } = require("chai");
const { ethers } = require("hardhat");
const https = require("https");

describe("ChainlinkOracle Price Retrieval on Forked Mainnet with CoinGecko Comparison", function () {
  let chainlinkOracle: any;
  let owner: any;
  let unauthorizedUser: any;

  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const UNI = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
  const SHIBA = "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE";

  const ETH_USD_ORACLE = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
  const USDC_USD_ORACLE = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
  const UNI_USD_ORACLE = "0x553303d460EE0afB37EdFf9bE42922D8FF63220e";
  const SHIBA_ETH_ORACLE = "0x8dD1CD88F43aF196ae478e91b9F5E4Ac69A97C61";

  const MAX_TIME_SINCE_LAST_UPDATE = 3600 * 12; // 12 hours
  const CACHE_EXPIRY = 3600; // 1 hour

  // Token to CoinGecko ID mapping
  const tokenToCoingeckoId = {
    [WETH]: "ethereum",
    [USDC]: "usd-coin",
    [UNI]: "uniswap",
    [SHIBA]: "shiba-inu",
  };

  // Cache structure for storing retrieved prices
  const priceCache: { [id: string]: { price: number; timestamp: number } } = {};

  async function getPriceFromCoinGecko(id: string): Promise<number> {
    const now = Date.now();
    const cached = priceCache[id];

    // Return cached price if within expiry time
    if (cached && now - cached.timestamp < CACHE_EXPIRY) {
      return cached.price;
    }

    try {
      // Fetch new price from CoinGecko if not cached or expired
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
      );

      if (!response.ok) {
        throw new Error(`Network response was not ok for ${id}`);
      }

      const jsonData = await response.json();
      const price = Number(jsonData[id]?.usd);

      // Update cache and return price
      priceCache[id] = { price, timestamp: now };
      return price;
    } catch (error) {
      throw new Error(`Failed to fetch or parse price for ${id}: ${error}`);
    }
  }

  async function getPriceRatioFromCoinGecko(
    baseToken: keyof typeof tokenToCoingeckoId,
    quoteToken: keyof typeof tokenToCoingeckoId
  ): Promise<number> {
    const baseId = tokenToCoingeckoId[baseToken];
    const quoteId = tokenToCoingeckoId[quoteToken];
    const basePriceUSD = await getPriceFromCoinGecko(baseId);
    const quotePriceUSD = await getPriceFromCoinGecko(quoteId);

    if (typeof basePriceUSD !== "number" || typeof quotePriceUSD !== "number") {
      throw new Error(
        `Invalid price data for tokens ${baseToken} or ${quoteToken}`
      );
    }
    return basePriceUSD / quotePriceUSD;
  }

  before(async function () {
    const chainId = await ethers.provider.send("eth_chainId");
    if (chainId !== "0x1") {
      console.log(
        "Skipping test: Only meant for forked mainnet on Mainnet to test with Chainlink feeds (chain ID 1)."
      );
      this.skip();
    }

    [owner, unauthorizedUser] = await ethers.getSigners();

    // Deploy ChainlinkOracle contract
    const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
    chainlinkOracle = await ChainlinkOracle.deploy(
      [USDC, WETH, UNI],
      [USDC_USD_ORACLE, ETH_USD_ORACLE, UNI_USD_ORACLE],
      ETH_USD_ORACLE,
      owner.address,
      WETH,
      MAX_TIME_SINCE_LAST_UPDATE
    );
  });

  describe("Price Retrieval", function () {
    it("should retrieve WETH price in USDC and compare with CoinGecko", async function () {
      const onChainPrice = await chainlinkOracle.getPrice(WETH, USDC, []);
      const coinGeckoPrice = await getPriceRatioFromCoinGecko(WETH, USDC);

      const usdcDecimals = await ethers
        .getContractAt("IERC20Metadata", USDC)
        .then((contract: any) => contract.decimals());
      const onchainPrice = ethers.formatUnits(onChainPrice, usdcDecimals);

      console.log("WETH price in USDC (on-chain):", onchainPrice);
      console.log("WETH price in USD (CoinGecko):", coinGeckoPrice);

      if (typeof coinGeckoPrice !== "number") {
        console.log(
          `Skipping test: Error retrieving coingecko price ${coinGeckoPrice}`
        );
        this.skip();
      }

      expect(Number(onchainPrice)).to.be.closeTo(
        coinGeckoPrice,
        coinGeckoPrice * 0.05
      ); // 5% tolerance
    });

    it("should retrieve UNI price in USDC and compare with CoinGecko", async function () {
      const onChainPrice = await chainlinkOracle.getPrice(UNI, USDC, []);
      const coinGeckoPrice = await getPriceRatioFromCoinGecko(UNI, USDC);

      const usdcDecimals = await ethers
        .getContractAt("IERC20Metadata", USDC)
        .then((contract: any) => contract.decimals());
      const onchainPrice = ethers.formatUnits(onChainPrice, usdcDecimals);

      console.log("UNI price in USDC (on-chain):", onchainPrice);
      console.log("UNI price in USD (CoinGecko):", coinGeckoPrice);

      if (typeof coinGeckoPrice !== "number") {
        console.log(
          `Skipping test: Error retrieving coingecko price ${coinGeckoPrice}`
        );
        this.skip();
      }
      expect(Number(onchainPrice)).to.be.closeTo(
        coinGeckoPrice,
        coinGeckoPrice * 0.05
      ); // 5% tolerance
    });

    it("should retrieve USDC price in WETH and compare with CoinGecko", async function () {
      const onChainPrice = await chainlinkOracle.getPrice(USDC, WETH, []);
      const coinGeckoPrice = await getPriceRatioFromCoinGecko(USDC, WETH);

      const wethDecimals = await ethers
        .getContractAt("IERC20Metadata", WETH)
        .then((contract: any) => contract.decimals());
      const onchainPrice = ethers.formatUnits(onChainPrice, wethDecimals);

      console.log("USDC price in WETH (on-chain):", onchainPrice);
      console.log("USDC price in USD (CoinGecko):", coinGeckoPrice);

      if (typeof coinGeckoPrice !== "number") {
        console.log(
          `Skipping test: Error retrieving coingecko price ${coinGeckoPrice}`
        );
        this.skip();
      }
      expect(Number(onchainPrice)).to.be.closeTo(
        coinGeckoPrice,
        coinGeckoPrice * 0.05
      ); // 5% tolerance
    });

    it("should retrieve UNI price in WETH and compare with CoinGecko", async function () {
      const onChainPrice = await chainlinkOracle.getPrice(UNI, WETH, []);
      const coinGeckoPrice = await getPriceRatioFromCoinGecko(UNI, WETH);

      const wethDecimals = await ethers
        .getContractAt("IERC20Metadata", WETH)
        .then((contract: any) => contract.decimals());
      const onchainPrice = ethers.formatUnits(onChainPrice, wethDecimals);

      console.log("UNI price in WETH (on-chain):", onchainPrice);
      console.log("UNI price in USD (CoinGecko):", coinGeckoPrice);

      if (typeof coinGeckoPrice !== "number") {
        console.log(
          `Skipping test: Error retrieving coingecko price ${coinGeckoPrice}`
        );
        this.skip();
      }
      expect(Number(onchainPrice)).to.be.closeTo(
        coinGeckoPrice,
        coinGeckoPrice * 0.05
      ); // 5% tolerance
    });

    it("should retrieve WETH price in UNI and compare with CoinGecko", async function () {
      const onChainPrice = await chainlinkOracle.getPrice(WETH, UNI, []);
      const coinGeckoPrice = await getPriceRatioFromCoinGecko(WETH, UNI);

      const uniDecimals = await ethers
        .getContractAt("IERC20Metadata", UNI)
        .then((contract: any) => contract.decimals());
      const onchainPrice = ethers.formatUnits(onChainPrice, uniDecimals);

      console.log("WETH price in UNI (on-chain):", onchainPrice);
      console.log("WETH price in USD (CoinGecko):", coinGeckoPrice);

      if (typeof coinGeckoPrice !== "number") {
        console.log(
          `Skipping test: Error retrieving coingecko price ${coinGeckoPrice}`
        );
        this.skip();
      }
      expect(Number(onchainPrice)).to.be.closeTo(
        coinGeckoPrice,
        coinGeckoPrice * 0.05
      ); // 5% tolerance
    });

    it("should revert if stale price", async function () {
      // Deploy ChainlinkOracle contract
      const veryShortStaleTime = 1;
      const ChainlinkOracle =
        await ethers.getContractFactory("ChainlinkOracle");
      const chainlinkOracleWithVeryShortStaleTime =
        await ChainlinkOracle.deploy(
          [USDC, WETH, UNI],
          [USDC_USD_ORACLE, ETH_USD_ORACLE, UNI_USD_ORACLE],
          ETH_USD_ORACLE,
          owner.address,
          WETH,
          veryShortStaleTime
        );

      await expect(
        chainlinkOracleWithVeryShortStaleTime.getPrice(WETH, USDC, [])
      ).to.be.revertedWithCustomError(
        chainlinkOracleWithVeryShortStaleTime,
        "InvalidOracleAnswer"
      );
    });
  });

  describe("Deployment", function () {
    it("should revert if deploying with invalid parameters", async function () {
      const ChainlinkOracle =
        await ethers.getContractFactory("ChainlinkOracle");

      await expect(
        ChainlinkOracle.deploy(
          [USDC],
          [USDC_USD_ORACLE, ETH_USD_ORACLE], // Mismatched array length
          ETH_USD_ORACLE,
          owner.address,
          WETH,
          MAX_TIME_SINCE_LAST_UPDATE
        )
      ).to.be.revertedWithCustomError(chainlinkOracle, "InvalidArrayLength");

      await expect(
        ChainlinkOracle.deploy(
          [USDC],
          [USDC_USD_ORACLE],
          ethers.ZeroAddress, // Invalid ETH/USD oracle address
          owner.address,
          WETH,
          MAX_TIME_SINCE_LAST_UPDATE
        )
      ).to.be.revertedWithCustomError(chainlinkOracle, "InvalidAddress");

      await expect(
        ChainlinkOracle.deploy(
          [USDC],
          [USDC_USD_ORACLE],
          ETH_USD_ORACLE,
          owner.address,
          ethers.ZeroAddress, // Invalid WETH address
          MAX_TIME_SINCE_LAST_UPDATE
        )
      ).to.be.revertedWithCustomError(chainlinkOracle, "InvalidAddress");

      await expect(
        ChainlinkOracle.deploy(
          [USDC],
          [USDC_USD_ORACLE],
          ETH_USD_ORACLE,
          owner.address,
          WETH,
          0 // Invalid max time since last update
        )
      ).to.be.revertedWithCustomError(
        chainlinkOracle,
        "InvalidMaxTimeSinceLastUpdate"
      );
    });
  });

  describe("Adding oracle mappings", function () {
    it("should revert if unauthorized users tries to add new mapping", async function () {
      await expect(
        chainlinkOracle
          .connect(unauthorizedUser)
          .addOracleMapping([SHIBA], [SHIBA_ETH_ORACLE])
      ).to.be.reverted;
    });

    it("should revert if attempting to overwrite an already set mapping", async function () {
      await expect(chainlinkOracle.addOracleMapping([WETH], [ETH_USD_ORACLE]))
        .to.be.revertedWithCustomError(chainlinkOracle, "OracleAlreadySet")
        .withArgs(ETH_USD_ORACLE);
    });

    it("should be able to add a new mapping", async function () {
      await chainlinkOracle
        .connect(owner)
        .addOracleMapping([SHIBA], [SHIBA_ETH_ORACLE]);

      const oracleInfo = await chainlinkOracle.oracleInfos(SHIBA);
      expect(oracleInfo[0]).to.be.equal(SHIBA_ETH_ORACLE);

      const onchainPriceInUsd = await chainlinkOracle.getPriceOfToken(SHIBA);

      const onChainPrice = await chainlinkOracle.getPrice(SHIBA, USDC, []);
      const usdcDecimals = await ethers
        .getContractAt("IERC20Metadata", USDC)
        .then((contract: any) => contract.decimals());
      const onchainPrice = ethers.formatUnits(onChainPrice, usdcDecimals);

      const coinGeckoPrice = await getPriceRatioFromCoinGecko(SHIBA, USDC);

      console.log("SHIBA price in USDC (on-chain):", onchainPrice);
      console.log("SHIBA price in USD (CoinGecko):", coinGeckoPrice);

      if (typeof coinGeckoPrice !== "number") {
        console.log(
          `Skipping test: Error retrieving coingecko price ${coinGeckoPrice}`
        );
        this.skip();
      }
      expect(Number(onchainPrice)).to.be.closeTo(
        coinGeckoPrice,
        coinGeckoPrice * 0.05
      ); // 5% tolerance
    });
  });
});
