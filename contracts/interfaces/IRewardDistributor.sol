// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IRewardDistributor {
    function depositRewards(
        uint256 epoch,
        address[] memory tokens,
        uint256[] memory amounts
    ) external;

    function isRewardToken(address token) external view returns (bool);

    function currentEpoch() external view returns (uint256);
}
