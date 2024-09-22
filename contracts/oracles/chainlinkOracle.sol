// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Errors} from "../../../Errors.sol";
import {IOracle} from "../interfaces/IOracle.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ChainlinkBase
 * @dev Abstract contract supporting Chainlink oracles with flexible decimal handling.
 *      Allows oracles with 18 (ETH) or 8 (USD) decimals. If an oracle has 8 decimals,
 *      it uses the ETH/USD oracle to convert the price to ETH.
 */
abstract contract ChainlinkBase is IOracle {
    // Immutable base currency unit (e.g., 1e18 for ETH)
    uint256 public immutable BASE_CURRENCY_UNIT;

    // Immutable address for the ETH/USD Chainlink oracle
    address public immutable ETH_USD_ORACLE;

    address public immutable WETH;

    // Maximum timestamp divergence for price updates
    uint256 private constant MAX_PRICE_UPDATE_TIMESTAMP_DIVERGENCE = 1 days;

    /**
     * @dev Struct to store oracle address and its decimals.
     *      Packed to optimize storage.
     *     decimals are the number of decimals in the oracle's price output,not underlying token.
     */
    struct OracleInfo {
        address oracleAddr;
        uint8 decimals;
    }

    error InvalidOracleAnswer();
    error InvalidAddress();
    error InvalidArrayLength();
    error InvalidOracleDecimals();
    error NoOracle();
    error OracleAlreadySet(address oracleAddr);

    // Mapping from token address to its OracleInfo
    mapping(address => OracleInfo) public oracleInfos;

    /**
     * @dev Constructor initializes oracle mappings and sets the ETH/USD oracle.
     * @param _tokenAddrs Array of token addresses.
     * @param _oracleAddrs Array of corresponding oracle addresses.
     * @param _ethUsdOracle Address of the ETH/USD Chainlink oracle.
     * @param _owner Address of the owner.
     */
    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address _ethUsdOracle,
        address _owner,
        address _weth
    ) Ownable(_owner) {
        uint256 tokenAddrsLength = _tokenAddrs.length;
        if (tokenAddrsLength == 0 || tokenAddrsLength != _oracleAddrs.length) {
            revert InvalidArrayLength();
        }

        if (_ethUsdOracle == address(0)) {
            revert InvalidAddress();
        }

        ETH_USD_ORACLE = _ethUsdOracle;
        WETH = _weth;

        uint8 oracleDecimals;

        for (uint256 i; i < tokenAddrsLength; ) {
            address token = _tokenAddrs[i];
            address oracle = _oracleAddrs[i];

            _checkAndStoreOracleInfo(token, oracle);

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Allows setting new oracles for tokens that do not already have an oracle set.
     *      Reverts if an oracle is already set for a token.
     * @param _tokenAddrs Array of token addresses.
     * @param _oracleAddrs Array of corresponding new oracle addresses.
     */
    function setNewOracles(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs
    ) external onlyOwner {
        uint256 length = _tokenAddrs.length;
        if (length != _oracleAddrs.length) {
            revert InvalidArrayLength();
        }

        for (uint256 i; i < length;) {
            address token = _tokenAddrs[i];
            address oracle = _oracleAddrs[i];

            OracleInfo storage existingInfo = oracleInfos[token];

            if (existingInfo.oracleAddr != address(0)) {
                revert OracleAlreadySet(existingInfo.oracleAddr);
            }

            _checkAndStoreOracleInfo(token, oracle);

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Returns the price of the settlement token in terms of the underlying token.
     * @param settlementToken Address of the settlement token.
     * @param underlyingToken Address of the underlying token.
    * @param data Additional data that may be required to fetch the price.
     * @return settlementTokenPriceInUnderlyingToken Price of settlement in underlying token.
     */
    function getPrice(
        address settlementToken,
        address underlyingToken,
        bytes[] data
    ) external view virtual returns (uint256 settlementTokenPriceInUnderlyingToken) {
        (uint256 priceOfSettlementToken, uint256 priceOfUnderlyingToken) = getRawPrices(
            settlementToken,
            underlyingToken
        );

        uint256 underlyingTokenDecimals = IERC20Metadata(underlyingToken).decimals();

        settlementTokenPriceInUnderlyingToken = Math.mulDiv(
            priceOfSettlementToken,
            10 ** underlyingTokenDecimals,
            priceOfUnderlyingToken
        );
    }

    /**
     * @dev Returns the raw prices of two tokens.
     * @param settlementToken Address of the settlement token.
     * @param underlyingToken Address of the underlying token.
     * @return settlementTokenPriceRaw Raw price of settlement token.
     * @return underlyingTokenPriceRaw Raw price of underlying token.
     */
    function getRawPrices(
        address settlementToken,
        address underlyingToken
    )
        public
        view
        virtual
        returns (uint256 settlementTokenPriceRaw, uint256 underlyingTokenPriceRaw)
    {
        settlementTokenPriceRaw = _getPriceOfToken(settlementToken);
        underlyingTokenPriceRaw = _getPriceOfToken(underlyingToken);
    }

    /**
     * @dev Internal function to get the price of a single token.
     *      Converts USD prices to ETH if necessary.
     * @param token Address of the token.
     * @return tokenPriceRaw Price of the token in ETH.
     */
    function _getPriceOfToken(
        address token
    ) internal view virtual returns (uint256 tokenPriceRaw) {
        if (token == WETH){
            return 1e18;
        }
        OracleInfo memory info = oracleInfos[token];
        if (info.oracleAddr == address(0)) {
            revert NoOracle();
        }

        // Fetch the raw price from the token's oracle
        uint256 rawPrice = _checkAndReturnLatestRoundData(info.oracleAddr);

        if (info.decimals == 18) {
            // Price is already in ETH
            tokenPriceRaw = rawPrice;
        } else {
            // Price is in USD, convert to ETH using ETH/USD oracle
            uint256 ethUsdPrice = _checkAndReturnLatestRoundData(ETH_USD_ORACLE);

            // Ensure ETH/USD oracle has 8 decimals
            // Convert USD to ETH: (price * 1e18) / ethUsdPrice
            tokenPriceRaw = Math.mulDiv(rawPrice, 1e18, ethUsdPrice);
        }
    }

    /**
     * @dev Internal function to fetch and validate the latest round data from a Chainlink oracle.
     * @param oracleAddr Address of the Chainlink oracle.
     * @return tokenPriceRaw The latest valid price from the oracle.
     */
    function _checkAndReturnLatestRoundData(
        address oracleAddr
    ) internal view virtual returns (uint256 tokenPriceRaw) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = AggregatorV3Interface(oracleAddr).latestRoundData();

        if (
            roundId == 0 ||
            answeredInRound < roundId ||
            answer < 1 ||
            updatedAt > block.timestamp ||
            updatedAt + MAX_PRICE_UPDATE_TIMESTAMP_DIVERGENCE < block.timestamp
        ) {
            revert InvalidOracleAnswer();
        }

        tokenPriceRaw = uint256(answer);
    }

    function _checkAndStoreOracleInfo(
        address token,
        address oracle
    ) internal {
        if (token == address(0) || oracle == address(0)) {
            revert InvalidAddress();
        }

        // Fetch decimals from the oracle
        uint8 decimals = AggregatorV3Interface(oracle).decimals();

        // Ensure oracle decimals are either 8 or 18, or handle conversion
        if (decimals != 8 && decimals != 18) {
            revert InvalidOracleDecimals();
        }

        // Store oracle information
        oracleInfos[token] = OracleInfo({
            oracleAddr: oracle,
            decimals: decimals
        });
    }
}
