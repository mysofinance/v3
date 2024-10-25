// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockChainlinkAggregator {
    uint8 private _decimals;
    int256 private _answer;

    constructor(uint8 decimals_) {
        _decimals = decimals_;
        _answer = 1000000; // Some default value
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (
            1,
            _answer,
            block.timestamp,
            block.timestamp,
            1
        );
    }
}