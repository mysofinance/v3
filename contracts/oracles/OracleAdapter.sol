// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Errors} from "../errors/Errors.sol";
import {IOracleAdapter} from "../interfaces/IOracleAdapter.sol";

/// @title OracleAdapter
/// @dev Abstract contract supporting Chainlink and similar oracles with flexible decimal handling.
///      Allows oracles with 18 (ETH) or 8 (USD) decimals. If an oracle has 8 decimals,
///      it uses the ETH/USD oracle to convert the price to ETH.
contract OracleAdapter is IOracleAdapter, Ownable {
    uint256 public immutable MAX_TIME_SINCE_LAST_UPDATE;
    address public immutable ETH_USD_ORACLE;
    address public immutable WETH;
    bool public immutable ORACLE_MAPPING_IS_APPEND_ONLY;

    /// @dev Struct to store oracle address and its decimals.
    /// Packed to optimize storage.
    /// decimals are the number of decimals in the oracle's price output, not underlying token.
    struct OracleInfo {
        address oracleAddr;
        uint8 decimals;
    }

    // Mapping from token address to its OracleInfo
    mapping(address => OracleInfo) public oracleInfos;

    event AddOracleMapping(address indexed tokenAddress, address oracleAddress);

    /// @dev Constructor initializes oracle mappings and sets the ETH/USD oracle.
    /// @param _tokenAddrs Array of token addresses.
    /// @param _oracleAddrs Array of corresponding oracle addresses.
    /// @param _ethUsdOracle Address of the ETH/USD Chainlink oracle.
    /// @param _owner Address of the owner.
    /// @param _maxTimeSinceLastUpdate Maximum time since last update.
    /// @param _oracleMappingIsAppendOnly Flag if oracle mapping is append only.
    constructor(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs,
        address _ethUsdOracle,
        address _owner,
        address _weth,
        uint256 _maxTimeSinceLastUpdate,
        bool _oracleMappingIsAppendOnly
    ) Ownable(_owner) {
        uint256 tokenAddrsLength = _tokenAddrs.length;
        if (tokenAddrsLength != _oracleAddrs.length) {
            revert Errors.InvalidArrayLength();
        }

        if (
            _ethUsdOracle == address(0) ||
            _weth == address(0) ||
            _ethUsdOracle == _weth
        ) {
            revert Errors.InvalidAddress();
        }

        if (_maxTimeSinceLastUpdate == 0) {
            revert Errors.InvalidMaxTimeSinceLastUpdate();
        }

        ETH_USD_ORACLE = _ethUsdOracle;
        WETH = _weth;
        MAX_TIME_SINCE_LAST_UPDATE = _maxTimeSinceLastUpdate;
        ORACLE_MAPPING_IS_APPEND_ONLY = _oracleMappingIsAppendOnly;

        for (uint256 i = 0; i < tokenAddrsLength; ++i) {
            _checkAndStoreOracleInfo(_tokenAddrs[i], _oracleAddrs[i]);
        }
    }

    /// @dev Allows setting new oracles for tokens that do not already have an oracle set.
    ///      Reverts if an oracle is already set for a token.
    /// @param _tokenAddrs Array of token addresses.
    /// @param _oracleAddrs Array of corresponding new oracle addresses.
    function addOracleMapping(
        address[] memory _tokenAddrs,
        address[] memory _oracleAddrs
    ) external onlyOwner {
        uint256 length = _tokenAddrs.length;
        if (length != _oracleAddrs.length) {
            revert Errors.InvalidArrayLength();
        }

        for (uint256 i = 0; i < length; ++i) {
            OracleInfo storage existingInfo = oracleInfos[_tokenAddrs[i]];
            if (
                ORACLE_MAPPING_IS_APPEND_ONLY &&
                existingInfo.oracleAddr != address(0)
            ) {
                revert Errors.OracleAlreadySet(existingInfo.oracleAddr);
            }
            _checkAndStoreOracleInfo(_tokenAddrs[i], _oracleAddrs[i]);
            emit AddOracleMapping(_tokenAddrs[i], _oracleAddrs[i]);
        }
    }

    /// @notice Retrieves the price of a specified token quoted in another token.
    /// @param token The address of the token for which the price is to be retrieved.
    /// @param quoteToken The address of the token in which the price is to be quoted.
    /// @return tokenPriceInQuoteToken The price of 1 unit of token (=10**token_decimal) quoted in the quoteToken.
    function getPrice(
        address token,
        address quoteToken,
        bytes[] memory /*oracleData*/
    ) external view virtual returns (uint256 tokenPriceInQuoteToken) {
        uint256 priceOfToken = getPriceOfToken(token);
        uint256 priceOfQuoteToken = getPriceOfToken(quoteToken);

        uint256 quoteTokenDecimals = IERC20Metadata(quoteToken).decimals();

        tokenPriceInQuoteToken = Math.mulDiv(
            priceOfToken,
            10 ** quoteTokenDecimals,
            priceOfQuoteToken
        );
    }

    /// @dev Public function to get the price of a single token in ETH.
    /// @dev Converts USD prices to ETH if necessary.
    /// @param token Address of the token.
    /// @return tokenPriceRaw Price of the token in ETH.
    function getPriceOfToken(
        address token
    ) public view virtual returns (uint256 tokenPriceRaw) {
        if (token == WETH) {
            return 1e18;
        }
        OracleInfo memory info = oracleInfos[token];
        if (info.oracleAddr == address(0)) {
            revert Errors.NoOracle();
        }

        // Fetch the raw price from the token's oracle
        uint256 rawPrice = _checkAndReturnLatestRoundData(info.oracleAddr);

        if (info.decimals == 18) {
            // Price is already in ETH
            tokenPriceRaw = rawPrice;
        } else {
            // Price is in USD, convert to ETH using ETH/USD oracle
            uint256 ethUsdPrice = _checkAndReturnLatestRoundData(
                ETH_USD_ORACLE
            );
            // Ensure ETH/USD oracle has 8 decimals
            // Convert USD to ETH: (price * 1e18) / ethUsdPrice
            tokenPriceRaw = Math.mulDiv(rawPrice, 1e18, ethUsdPrice);
        }
    }

    /// @dev Internal function to fetch and validate the latest round data from a Chainlink oracle.
    /// @param oracleAddr Address of the Chainlink oracle.
    /// @return tokenPriceRaw The latest valid price from the oracle.
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
            updatedAt + MAX_TIME_SINCE_LAST_UPDATE < block.timestamp
        ) {
            revert Errors.InvalidOracleAnswer();
        }

        tokenPriceRaw = uint256(answer);
    }

    function _checkAndStoreOracleInfo(address token, address oracle) internal {
        if (
            token == address(0) ||
            oracle == address(0) ||
            token == WETH ||
            oracle == ETH_USD_ORACLE
        ) {
            revert Errors.InvalidAddress();
        }

        // Fetch decimals from the oracle
        uint8 decimals = AggregatorV3Interface(oracle).decimals();

        // Ensure oracle decimals are either 8 or 18
        if (decimals != 8 && decimals != 18) {
            revert Errors.InvalidOracleDecimals();
        }

        // Store oracle information
        oracleInfos[token] = OracleInfo({
            oracleAddr: oracle,
            decimals: decimals
        });
    }
}
