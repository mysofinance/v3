// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IOracleAdapter
/// @dev Interface for OracleAdapter contract to provide a standard way of interacting with oracles.
interface IOracleAdapter {
    /// @notice Event emitted when a new oracle mapping is added.
    /// @param tokenAddress The address of the token for which the oracle is being added.
    /// @param oracleAddress The address of the oracle to be used for given token.
    event AddOracleMapping(address indexed tokenAddress, address oracleAddress);

    /// @notice Retrieves the price of a specified token quoted in another token.
    /// @param token The address of the token for which the price is to be retrieved.
    /// @param quoteToken The address of the token in which the price is to be quoted.
    /// @param oracleData Additional data to pass to the oracle (if needed).
    /// @return tokenPriceInQuoteToken The price of 1 unit of token quoted in the quoteToken.
    function getPrice(
        address token,
        address quoteToken,
        bytes[] memory oracleData
    ) external view returns (uint256 tokenPriceInQuoteToken);

    /// @notice Retrieves the price of a token in ETH.
    /// @param token The address of the token.
    /// @return tokenPriceRaw The price of the token in ETH.
    function getPriceOfToken(
        address token
    ) external view returns (uint256 tokenPriceRaw);

    /// @notice Adds new oracle mappings for specified tokens.
    /// @param tokenAddrs Array of token addresses.
    /// @param oracleAddrs Array of corresponding oracle addresses.
    function addOracleMapping(
        address[] memory tokenAddrs,
        address[] memory oracleAddrs
    ) external;

    /// @notice Retrieves the ETH/USD oracle address.
    /// @return ethUsdOracle The address of the ETH/USD oracle.
    function ETH_USD_ORACLE() external view returns (address ethUsdOracle);

    /// @notice Retrieves the WETH address.
    /// @return weth The address of the WETH token.
    function WETH() external view returns (address weth);

    /// @notice Checks if the oracle mapping is append-only.
    /// @return isAppendOnly True if the oracle mapping is append-only, false otherwise.
    function ORACLE_MAPPING_IS_APPEND_ONLY()
        external
        view
        returns (bool isAppendOnly);

    /// @notice Retrieves the maximum allowed time since the last oracle update.
    /// @return maxTime The maximum time since the last update in seconds.
    function MAX_TIME_SINCE_LAST_UPDATE()
        external
        view
        returns (uint256 maxTime);

    /// @notice Retrieves the OracleInfo struct for a specific token.
    /// @param token The address of the token.
    /// @return oracleAddr The address of the oracle.
    /// @return decimals The decimals used by the oracle.
    function oracleInfos(
        address token
    ) external view returns (address oracleAddr, uint8 decimals);
}
