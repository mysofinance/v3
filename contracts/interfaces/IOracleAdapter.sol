// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IOracleAdapter {
    /// @notice Retrieves the price of a specified token quoted in another token.
    /// @param token The address of the token for which the price is to be retrieved.
    /// @param quoteToken The address of the token in which the price is to be quoted.
    /// @param oracleData Additional data that may be required to fetch the price.
    /// The structure and content of this data can vary depending on the implementation
    /// and use case. For example, one can pass an optimistic price with signature to verify.
    /// @return The price of 1 unit of token (=10**token_decimal) quoted in the quoteToken.
    function getPrice(
        address token,
        address quoteToken,
        bytes[] memory oracleData
    ) external view returns (uint256);
}
