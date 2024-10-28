import { chainlink } from "../typechain-types";

const { expect } = require("chai");
const { ethers } = require("hardhat");

import { getLatestTimestamp } from "./helpers";

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

  describe("Forked Mainnet Tests", function () {
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
      const ChainlinkOracle =
        await ethers.getContractFactory("ChainlinkOracle");
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

  describe("OracleAdapter with Mock Aggregator", function () {
    let oracleAdapter: any;
    let mockAggregatorEthUsd: any;
    let mockAggregatorUsdcUsd: any;
    let mockAggregatorUniUsd: any;
    let USDC: any;
    let WETH: any;
    let UNI: any;
    let owner: any;
    let user2: any;
    let unauthorizedUser: any;

    const MAX_TIME_SINCE_LAST_UPDATE = 3600 * 12; // 12 hours

    beforeEach(async function () {
      [owner, user2, unauthorizedUser] = await ethers.getSigners();

      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const weth = await MockERC20.deploy("WETH", "WETH", 18);
      const usdc = await MockERC20.deploy("USDC", "USDC", 6);
      const uni = await MockERC20.deploy("UNI", "UNI", 18);

      WETH = weth.target;
      USDC = usdc.target;
      UNI = uni.target;

      // Deploy the Mock Aggregator
      const MockAggregator =
        await ethers.getContractFactory("MockAggregatorV3");

      mockAggregatorEthUsd = await MockAggregator.deploy(
        8,
        ethers.parseUnits("2500", 8)
      );
      mockAggregatorUsdcUsd = await MockAggregator.deploy(
        8,
        ethers.parseUnits("1", 8)
      );
      mockAggregatorUniUsd = await MockAggregator.deploy(
        18,
        ethers.parseUnits("0.002972", 18)
      );

      // Deploy OracleAdapter contract using the mock aggregator
      const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
      oracleAdapter = await OracleAdapter.deploy(
        [USDC],
        [mockAggregatorUsdcUsd.target], // Using the mock for both tokens
        mockAggregatorEthUsd.target, // Mock ETH/USD Oracle
        owner.address,
        WETH,
        MAX_TIME_SINCE_LAST_UPDATE,
        true // ORACLE_MAPPING_IS_APPEND_ONLY = true
      );
    });

    describe("Deployment", function () {
      it("should initialize correctly with the mock oracles", async function () {
        const ethUsdOracle = await oracleAdapter.ETH_USD_ORACLE();
        expect(ethUsdOracle).to.equal(mockAggregatorEthUsd.target);
        expect(await oracleAdapter.WETH()).to.equal(WETH);
      });

      it("should revert if max. time since last update time is zero", async function () {
        const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
        await expect(
          OracleAdapter.deploy(
            [USDC],
            [mockAggregatorUsdcUsd.target],
            mockAggregatorEthUsd.target,
            owner.address,
            WETH,
            0,
            true
          )
        ).to.be.revertedWithCustomError(
          oracleAdapter,
          "InvalidMaxTimeSinceLastUpdate"
        );
      });

      it("should revert if deployed with invalid oracle address", async function () {
        const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
        await expect(
          OracleAdapter.deploy(
            [USDC],
            [ethers.ZeroAddress], // Invalid oracle address
            mockAggregatorEthUsd.target,
            owner.address,
            WETH,
            MAX_TIME_SINCE_LAST_UPDATE,
            true
          )
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidAddress");
      });

      it("should revert if token and oracle arrays length mismatch", async function () {
        const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
        await expect(
          OracleAdapter.deploy(
            [USDC, WETH], // Two tokens
            [mockAggregatorUsdcUsd.target], // Only one oracle
            mockAggregatorEthUsd.target,
            owner.address,
            WETH,
            MAX_TIME_SINCE_LAST_UPDATE,
            true
          )
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidArrayLength");
      });

      it("should revert if deployed with invalid ETH/USD or WETH address", async function () {
        const OracleAdapter = await ethers.getContractFactory("OracleAdapter");

        // Test case for ETH/USD oracle being an invalid address
        await expect(
          OracleAdapter.deploy(
            [USDC],
            [mockAggregatorUsdcUsd.target],
            ethers.ZeroAddress, // Invalid ETH/USD oracle address
            owner.address,
            WETH,
            MAX_TIME_SINCE_LAST_UPDATE,
            true
          )
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidAddress");

        // Test case for WETH being an invalid address
        await expect(
          OracleAdapter.deploy(
            [USDC],
            [mockAggregatorUsdcUsd.target],
            mockAggregatorEthUsd.target,
            owner.address,
            ethers.ZeroAddress, // Invalid WETH address
            MAX_TIME_SINCE_LAST_UPDATE,
            true
          )
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidAddress");

        // Test case for ETH/USD oracle and WETH being the same address
        await expect(
          OracleAdapter.deploy(
            [USDC],
            [mockAggregatorUsdcUsd.target],
            mockAggregatorEthUsd.target, // Same address as WETH
            owner.address,
            mockAggregatorEthUsd.target,
            MAX_TIME_SINCE_LAST_UPDATE,
            true
          )
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidAddress");
      });
    });

    describe("Price Retrieval", function () {
      it("should retrieve correct price from the mock aggregator", async function () {
        const priceInEth = await oracleAdapter.getPriceOfToken(WETH);
        const priceInUsdc = await oracleAdapter.getPrice(WETH, USDC, []);
        const expectedPriceInEth = ethers.parseUnits("1", 18);
        const expectedPriceInUsdc = ethers.parseUnits("2500", 6);
        expect(priceInEth).to.equal(expectedPriceInEth);
        expect(priceInUsdc).to.equal(expectedPriceInUsdc);
      });

      it("should convert USD to ETH correctly using mock ETH/USD oracle", async function () {
        await mockAggregatorEthUsd.setLatestAnswer(
          ethers.parseUnits("1500", 8)
        );
        const priceInEth = await oracleAdapter.getPrice(USDC, WETH, []); // Expecting 1 USDC in ETH
        const expectedPriceInEth =
          (10n ** 18n * 10n ** 8n) / (1500n * 10n ** 8n);

        expect(priceInEth).to.equal(expectedPriceInEth);
      });

      it("should correctly handle token price with 8 decimal oracle", async function () {
        await mockAggregatorUniUsd.setLatestAnswer(
          ethers.parseUnits("0.002972", 18)
        );
        await oracleAdapter.addOracleMapping(
          [UNI],
          [mockAggregatorUniUsd.target]
        );
        expect(await mockAggregatorUniUsd.decimals()).to.be.equal(18);

        const priceInEth = await oracleAdapter.getPriceOfToken(UNI);
        expect(priceInEth).to.be.equal(ethers.parseUnits("0.002972", 18));
        const priceInUsdc = await oracleAdapter.getPrice(UNI, USDC, []);
        const expectedPriceInUsdc = ethers.parseUnits("7.43", 6);
        expect(priceInUsdc).to.equal(expectedPriceInUsdc);
      });

      it("should revert if attempting to fetch price for unsupported token", async function () {
        const randomToken = ethers.Wallet.createRandom().address;
        await expect(
          oracleAdapter.getPriceOfToken(randomToken)
        ).to.be.revertedWithCustomError(oracleAdapter, "NoOracle");
      });

      it("should revert if roundId == zero", async function () {
        const latestTimestamp = await getLatestTimestamp();
        const roundId = 0; // invalid round id
        const answer = 1;
        const startedAt = latestTimestamp;
        const updatedAt = latestTimestamp;
        const answeredInRound = 1;

        await mockAggregatorUsdcUsd.setLatestRoundData(
          roundId,
          answer,
          startedAt,
          updatedAt,
          answeredInRound
        );
        await expect(
          oracleAdapter.getPrice(USDC, WETH, [])
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidOracleAnswer");
      });

      it("should revert if answer < 1", async function () {
        const latestTimestamp = await getLatestTimestamp();
        const roundId = 1;
        const answer = 0; // invalid answer
        const startedAt = latestTimestamp;
        const updatedAt = latestTimestamp;
        const answeredInRound = 1;

        await mockAggregatorUsdcUsd.setLatestRoundData(
          roundId,
          answer,
          startedAt,
          updatedAt,
          answeredInRound
        );
        await expect(
          oracleAdapter.getPrice(USDC, WETH, [])
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidOracleAnswer");
      });

      it("should revert if answeredInRound < roundId", async function () {
        const latestTimestamp = await getLatestTimestamp();
        const roundId = 2;
        const answer = 1000;
        const startedAt = latestTimestamp;
        const updatedAt = latestTimestamp;
        const answeredInRound = 1; // less than roundId

        await mockAggregatorUsdcUsd.setLatestRoundData(
          roundId,
          answer,
          startedAt,
          updatedAt,
          answeredInRound
        );
        await expect(
          oracleAdapter.getPrice(USDC, WETH, [])
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidOracleAnswer");
      });

      it("should revert if updatedAt > block.timestamp", async function () {
        const latestTimestamp = await getLatestTimestamp();
        const roundId = 1;
        const answer = 1000;
        const startedAt = latestTimestamp;
        const updatedAt = latestTimestamp + 1000; // future timestamp
        const answeredInRound = 1;

        await mockAggregatorUsdcUsd.setLatestRoundData(
          roundId,
          answer,
          startedAt,
          updatedAt,
          answeredInRound
        );
        await expect(
          oracleAdapter.getPrice(USDC, WETH, [])
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidOracleAnswer");
      });

      it("should revert if updatedAt + MAX_TIME_SINCE_LAST_UPDATE < block.timestamp", async function () {
        const MAX_TIME_SINCE_LAST_UPDATE =
          await oracleAdapter.MAX_TIME_SINCE_LAST_UPDATE();
        const latestTimestamp = await getLatestTimestamp();
        const roundId = 1;
        const answer = 1000;
        const startedAt = latestTimestamp;
        const updatedAt =
          BigInt(latestTimestamp) - 2n * MAX_TIME_SINCE_LAST_UPDATE; // outdated timestamp
        const answeredInRound = 1;

        await mockAggregatorUsdcUsd.setLatestRoundData(
          roundId,
          answer,
          startedAt,
          updatedAt,
          answeredInRound
        );
        await expect(
          oracleAdapter.getPrice(USDC, WETH, [])
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidOracleAnswer");
      });
    });

    describe("Stale Price Handling", function () {
      it("should revert if the oracle returns a stale price", async function () {
        const veryShortStaleTime = 1; // 1 second max time since last update
        const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
        const oracleWithShortStaleTime = await OracleAdapter.deploy(
          [USDC],
          [mockAggregatorUsdcUsd.target],
          mockAggregatorEthUsd.target,
          owner.address,
          WETH,
          veryShortStaleTime,
          true
        );

        expect(
          await oracleWithShortStaleTime.MAX_TIME_SINCE_LAST_UPDATE()
        ).to.be.equal(veryShortStaleTime);

        await mockAggregatorEthUsd.setLatestAnswer(
          ethers.parseUnits("2500", 8)
        );
        await ethers.provider.send("evm_increaseTime", [
          veryShortStaleTime + 1,
        ]); // Increase time by veryShortStaleTime
        await ethers.provider.send("evm_mine", []);

        // Note fetching ETH price will not fail as it always returns 10**18
        expect(
          await oracleWithShortStaleTime.getPriceOfToken(WETH)
        ).to.be.equal(ethers.parseEther("1"));

        // Expect other prices to fail
        await expect(
          oracleWithShortStaleTime.getPriceOfToken(USDC)
        ).to.be.revertedWithCustomError(
          oracleWithShortStaleTime,
          "InvalidOracleAnswer"
        );
        await expect(
          oracleWithShortStaleTime.getPrice(WETH, USDC, [])
        ).to.be.revertedWithCustomError(
          oracleWithShortStaleTime,
          "InvalidOracleAnswer"
        );
      });
    });

    describe("Oracle Management", function () {
      it("should allow owner to add new oracle mappings", async function () {
        await oracleAdapter
          .connect(owner)
          .addOracleMapping([UNI], [mockAggregatorUniUsd.target]);
        const oracleInfo = await oracleAdapter.oracleInfos(UNI);
        expect(oracleInfo.oracleAddr).to.equal(mockAggregatorUniUsd.target);
      });

      it("should revert if invalid oracle mapping array length", async function () {
        await expect(
          oracleAdapter
            .connect(owner)
            .addOracleMapping([UNI, USDC], [mockAggregatorUniUsd.target])
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidArrayLength");
      });

      it("should revert if adding oracle for token with address(0) or WETH address", async function () {
        await expect(
          oracleAdapter
            .connect(owner)
            .addOracleMapping(
              [ethers.ZeroAddress],
              [mockAggregatorUniUsd.target]
            )
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidAddress");
        await expect(
          oracleAdapter
            .connect(owner)
            .addOracleMapping([WETH], [mockAggregatorUniUsd.target])
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidAddress");
      });

      it("should revert if adding oracle for oracle with WETH address", async function () {
        await expect(
          oracleAdapter
            .connect(owner)
            .addOracleMapping([UNI], [mockAggregatorEthUsd.target])
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidAddress");
      });

      it("should allow owner to transfer ownership", async function () {
        await oracleAdapter.connect(owner).transferOwnership(user2.address);
        await oracleAdapter
          .connect(user2)
          .transferOwnership("0x000000000000000000000000000000000000dEaD");
      });

      it("should revert if unauthorized user tries to add oracle mapping", async function () {
        await expect(
          oracleAdapter
            .connect(unauthorizedUser)
            .addOracleMapping([UNI], [mockAggregatorUniUsd.target])
        ).to.be.reverted;
      });

      it("should revert if trying to overwrite an existing oracle mapping in append-only mode", async function () {
        await expect(
          oracleAdapter.addOracleMapping([USDC], [mockAggregatorUsdcUsd.target])
        ).to.be.revertedWithCustomError(oracleAdapter, "OracleAlreadySet");
      });

      it("should revert if oracle decimals are not 8 or 18", async function () {
        const MockAggregator =
          await ethers.getContractFactory("MockAggregatorV3");
        const invalidAggregator = await MockAggregator.deploy(
          12,
          ethers.parseUnits("100", 12)
        ); // Invalid 12 decimals

        await expect(
          oracleAdapter.addOracleMapping([UNI], [invalidAggregator.target])
        ).to.be.revertedWithCustomError(oracleAdapter, "InvalidOracleDecimals");
      });
    });
  });
});
