// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../interfaces/IOracle.sol";

contract MockOracle is IOracle {
    // Mapping to store mock prices for token pairs
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
        uint256 /*optimisticPrice*/,
        bytes[] memory /*data*/
    ) external view override returns (uint256) {
        // In a real implementation, you might verify the optimisticPrice and data,
        // but here we'll simply return the mocked price.
        uint256 price = prices[token][quoteToken];
        require(price != 0, "Price not available for this token pair");

        return price;
    }
}
