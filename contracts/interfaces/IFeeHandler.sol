// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {DataTypes} from "../DataTypes.sol";

/// @title IFeeHandler
/// @dev Interface for the FeeHandler contract.
/// Provides functionality for managing and distributing fees, and setting fee configurations.

interface IFeeHandler {
    /// @notice Emitted when fees are provisioned.
    /// @param token The address of the token in which fees are provisioned.
    /// @param amount The amount of the token provisioned as fees.
    event ProvisionFees(address indexed token, uint256 amount);

    /// @notice Emitted when tokens are withdrawn from the FeeHandler.
    /// @param to The address receiving the withdrawn tokens.
    /// @param token The address of the token being withdrawn.
    /// @param amount The amount of tokens withdrawn.
    event Withdraw(address indexed to, address indexed token, uint256 amount);

    /// @notice Emitted when match fee is set.
    /// @param matchFee The match fee set as a percentage.
    event SetMatchFee(uint256 matchFee);

    /// @notice Emitted when match fees for specific pairs are updated or removed.
    /// @param underlyingTokens The underlying tokens defining each pair.
    /// @param settlementTokens The settlement tokens defining each pair.
    /// @param matchFeesPerPair The match fee structs of given pairs.
    event SetMatchFeePerPair(
        address[] underlyingTokens,
        address[] settlementTokens,
        DataTypes.MatchFeePerPair[] matchFeesPerPair
    );

    /// @notice Emitted when mint fee is set.
    /// @param mintFee The mint fee set as a percentage.
    event SetMintFee(uint256 mintFee);

    /// @notice Emitted when the exercise fee is set.
    /// @param exerciseFee The exercise fee set as a percentage.
    event SetExerciseFee(uint96 exerciseFee);

    /// @notice Emitted when distribution partners are set.
    /// @param accounts The addresses of the distribution partners.
    /// @param feeShares The fee shares for given distribution partners.
    event SetDistPartnerFeeShares(address[] accounts, uint256[] feeShares);

    /// @notice Provisions fees in a specified token.
    /// @param token The address of the token in which fees are provisioned.
    /// @param amount The amount of the token provisioned as fees.
    function provisionFees(address token, uint256 amount) external;

    /// @notice Withdraws a specified amount of tokens to a given address.
    /// @param to The address receiving the withdrawn tokens.
    /// @param token The address of the token to withdraw.
    /// @param amount The amount of tokens to withdraw.
    function withdraw(address to, address token, uint256 amount) external;

    /// @notice Returns the match fee and distribution partner fee share for a given option trade.
    /// @param distPartner The address of the distribution partner.
    /// @param optionInfo The details of the option, including underlying and settlement tokens.
    /// @return _matchFee The applicable match fee for the given option.
    /// @return _matchFeeDistPartnerShare The distribution partner's share of the match fee.
    function getMatchFeeInfo(
        address distPartner,
        uint128 optionPremium,
        DataTypes.OptionInfo calldata optionInfo
    )
        external
        view
        returns (uint256 _matchFee, uint256 _matchFeeDistPartnerShare);

    /// @notice Returns the mint fee and fee share for given distribution partner.
    /// @param distPartner The address of the distribution partner.
    /// @return _mintFee The mint fee as a percentage.
    /// @return _mintFeeDistPartnerShare The share of the mint fee for the distribution partner.
    function getMintFeeInfo(
        address distPartner
    )
        external
        view
        returns (uint256 _mintFee, uint256 _mintFeeDistPartnerShare);

    /// @notice Sets distribution partners and their status.
    /// @param accounts The addresses of the distribution partners.
    /// @param feeShares The fee shares for given distribution partners.
    function setDistPartnerFeeShares(
        address[] calldata accounts,
        uint256[] calldata feeShares
    ) external;

    /// @notice Sets the match fee and distribution partner share.
    /// @param _matchFee The match fee as a percentage.
    function setMatchFee(uint96 _matchFee) external;

    /// @notice Sets or removes match fees for specific token pairs.
    /// @param underlyingTokens The list of underlying tokens for the pairs.
    /// @param settlementTokens The list of settlement tokens for the pairs.
    /// @param _matchFeePerPair The list of match fee structs per pair.
    function setMatchFeePerPair(
        address[] calldata underlyingTokens,
        address[] calldata settlementTokens,
        DataTypes.MatchFeePerPair[] calldata _matchFeePerPair
    ) external;

    /// @notice Sets the exercise fee.
    /// @param _exerciseFee The exercise fee as a percentage.
    function setExerciseFee(uint96 _exerciseFee) external;

    /// @notice Returns the match fee set in the FeeHandler.
    /// @return The match fee as a percentage.
    function matchFee() external view returns (uint96);

    /// @notice Returns the distribution fee share for a given account.
    /// @return The fee share for the given distribution partner.
    function distPartnerFeeShare(
        address account
    ) external view returns (uint256);

    /// @notice Returns the exercise fee set in the FeeHandler.
    /// @return The exercise fee as a percentage.
    function exerciseFee() external view returns (uint96);
}
