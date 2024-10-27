// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../interfaces/IOracleAdapter.sol";

contract MockOracle is IOracleAdapter {
    mapping(address => mapping(address => uint256)) public prices;

    function setPrice(
        address token,
        address quoteToken,
        uint256 price
    ) external {
        prices[token][quoteToken] = price;
    }

    function getPrice(
        address token,
        address quoteToken,
        bytes[] memory /*oracleData*/
    ) external view override returns (uint256) {
        uint256 price = prices[token][quoteToken];
        require(price != 0, "Price not available for this token pair");

        return price;
    }
}
