// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {DataTypes} from "../DataTypes.sol";

/**
 * @title IEscrow
 * @dev Interface for the Escrow contract.
 * Provides functionality for initializing auctions, bids, options, and managing underlying tokens.
 */
interface IEscrow {
    /// @notice Emitted when on-chain voting rights are delegated.
    /// @param delegate The address delegated for on-chain voting.
    event OnChainVotingDelegation(address delegate);

    /// @notice Emitted when off-chain voting rights are delegated.
    /// @param allowedDelegateRegistry Address of the allowed delegate registry.
    /// @param spaceId ID of the delegation space (e.g., for Snapshot).
    /// @param delegate The address delegated for off-chain voting.
    event OffChainVotingDelegation(
        address allowedDelegateRegistry,
        bytes32 spaceId,
        address delegate
    );

    /// @notice Emitted when tokens are withdrawn from the escrow.
    /// @param sender The address initiating the withdrawal.
    /// @param to The address receiving the withdrawn funds.
    /// @param token The address of the token being withdrawn.
    /// @param amount The amount of tokens withdrawn.
    event Withdraw(
        address indexed sender,
        address indexed to,
        address indexed token,
        uint256 amount
    );

    /// @notice Emitted when escrow ownership is transferred to a new owner.
    /// @param sender The address initiating the ownership transfer.
    /// @param oldOwner The address of the previous owner.
    /// @param newOwner The address of the new owner.
    event TransferOwnership(
        address indexed sender,
        address oldOwner,
        address newOwner
    );

    /// @notice Emitted when a redeem action is performed.
    /// @param sender The address initiating the redemption.
    /// @param to The address receiving the redeemed underlying tokens.
    /// @param underlyingToken The address of the underlying token being redeemed.
    /// @param amount The amount of underlying tokens redeemed.
    event Redeem(
        address indexed sender,
        address to,
        address underlyingToken,
        uint256 amount
    );

    /// @notice Returns the premium paid for the option.
    /// @return premiumPaid Amount of premium paid for the option.
    function premiumPaid() external view returns (uint128);

    /// @notice Returns the total amount borrowed in the underlying token.
    /// @return totalBorrowed Total borrowed amount.
    function totalBorrowed() external view returns (uint128);

    /// @notice Returns the address of the router linked to this Escrow.
    /// @return router The address of the router.
    function router() external view returns (address);

    /// @notice Returns the exercise fee set in the Escrow.
    /// @return exerciseFee The exercise fee as a percentage.
    function exerciseFee() external view returns (uint96);

    /// @notice Returns the address of the owner of the Escrow.
    /// @return owner The address of the current owner.
    function owner() external view returns (address);

    /// @notice Indicates if the escrow is set up for an auction.
    /// @return isAuction Boolean indicating auction status.
    function isAuction() external view returns (bool);

    /// @notice Indicates if the option has been minted.
    /// @return optionMinted Boolean indicating if the option is minted.
    function optionMinted() external view returns (bool);

    /// @notice Initializes the Escrow contract for an auction.
    /// @param _router The router address.
    /// @param _owner The address of the auction owner.
    /// @param _exerciseFee The exercise fee to be applied in case of exercise.
    /// @param _auctionInitialization Struct containing auction parameters.
    /// @param oTokenIndex Index for identifying the option token.
    /// @param distPartner The distribution partner address.
    function initializeAuction(
        address _router,
        address _owner,
        uint96 _exerciseFee,
        DataTypes.AuctionInitialization calldata _auctionInitialization,
        uint256 oTokenIndex,
        address distPartner
    ) external;

    /// @notice Initializes the Escrow for a matched RFQ.
    /// @param _router The router address.
    /// @param _owner The address of the escrow owner.
    /// @param optionReceiver Address receiving the option tokens.
    /// @param _exerciseFee The exercise fee to be applied in case of exercise.
    /// @param _rfqInitialization Struct containing RFQ parameters.
    /// @param oTokenIndex Index for identifying the option token.
    function initializeRFQMatch(
        address _router,
        address _owner,
        address optionReceiver,
        uint96 _exerciseFee,
        DataTypes.RFQInitialization calldata _rfqInitialization,
        uint256 oTokenIndex
    ) external;

    /// @notice Initializes the Escrow when minting a standalone option.
    /// @param _router The router address.
    /// @param _owner The address of the option owner.
    /// @param optionReceiver Address receiving the minted option tokens.
    /// @param _exerciseFee The exercise fee to be applied in case of exercise.
    /// @param _optionInfo Struct containing option information.
    /// @param _optionNaming Struct containing the name and symbol of the option token.
    function initializeMintOption(
        address _router,
        address _owner,
        address optionReceiver,
        uint96 _exerciseFee,
        DataTypes.OptionInfo calldata _optionInfo,
        DataTypes.OptionNaming calldata _optionNaming
    ) external;

    /// @notice Handles bidding on an auction.
    /// @param relBid Relative bid as percentage of notional.
    /// @param optionReceiver Address receiving the option tokens.
    /// @param _refSpot Reference spot price.
    /// @param _oracleData Additional optional oracle data.
    /// @return preview Returns a BidPreview struct with the bid's outcome.
    /// @return distPartner Returns the address of the distribution partner.
    function handleAuctionBid(
        uint256 relBid,
        address optionReceiver,
        uint256 _refSpot,
        bytes[] memory _oracleData
    )
        external
        returns (DataTypes.BidPreview memory preview, address distPartner);

    /// @notice Executes option exercise.
    /// @param exerciser The address exercising the option.
    /// @param underlyingReceiver Address receiving the underlying tokens.
    /// @param underlyingExerciseAmount Amount of underlying tokens to exercise.
    /// @param payInSettlementToken True if settlement is in the settlement token.
    /// @param oracleData Additional optional oracle data.
    /// @return settlementToken Address of the settlement token.
    /// @return settlementAmount Amount of settlement tokens paid.
    /// @return exerciseFeeAmount The fee applied for exercising.
    function handleExercise(
        address exerciser,
        address underlyingReceiver,
        uint256 underlyingExerciseAmount,
        bool payInSettlementToken,
        bytes[] memory oracleData
    )
        external
        returns (
            address settlementToken,
            uint256 settlementAmount,
            uint256 exerciseFeeAmount
        );

    /// @notice Handles borrowing of underlying tokens.
    /// @param borrower The address borrowing the tokens.
    /// @param underlyingReceiver Address receiving the borrowed tokens.
    /// @param underlyingBorrowAmount Amount of underlying tokens to borrow.
    /// @return settlementToken Address of the settlement token.
    /// @return collateralAmount Amount of collateral required.
    /// @return collateralFeeAmount The collateral fee applied for borrowing.
    function handleBorrow(
        address borrower,
        address underlyingReceiver,
        uint128 underlyingBorrowAmount
    )
        external
        returns (
            address settlementToken,
            uint256 collateralAmount,
            uint256 collateralFeeAmount
        );

    /// @notice Handles repayment of borrowed underlying tokens.
    /// @param borrower The address repaying the loan.
    /// @param collateralReceiver Address receiving the unlocked collateral.
    /// @param underlyingRepayAmount Amount of underlying tokens to repay.
    /// @return underlyingToken Address of the underlying token.
    /// @return unlockedCollateralAmount Amount of collateral unlocked upon repayment.
    function handleRepay(
        address borrower,
        address collateralReceiver,
        uint128 underlyingRepayAmount
    )
        external
        returns (address underlyingToken, uint256 unlockedCollateralAmount);

    /// @notice Delegates voting rights on-chain to a specified delegate.
    /// @param delegate The address to delegate voting rights to.
    function handleOnChainVoting(address delegate) external;

    /// @notice Delegates voting rights off-chain to a specified delegate.
    /// @param spaceId ID of the delegation space (e.g., for Snapshot).
    /// @param delegate The address to delegate voting rights to.
    function handleOffChainVoting(bytes32 spaceId, address delegate) external;

    /// @notice Withdraws a specified amount of tokens to a given address.
    /// @param to Address receiving the withdrawn tokens.
    /// @param token Address of the token to withdraw.
    /// @param amount Amount of tokens to withdraw.
    function handleWithdraw(address to, address token, uint256 amount) external;

    /// @notice Allows the escrow owner to redeem option tokens for underlying.
    /// @param to The address that will receive the underlying tokens upon redemption.
    function redeem(address to) external;

    /// @notice Transfers ownership of the Escrow to a new owner.
    /// @param newOwner Address of the new owner.
    function transferOwnership(address newOwner) external;

    /// @notice Previews the result of a bid on the auction.
    /// @param relBid Relative bid in percentage of notional.
    /// @param _refSpot Reference spot price.
    /// @param _oracleData Additional optional oracle data.
    /// @return preview Returns a BidPreview struct with the bid's outcome.
    /// @return distPartner Returns the address of the distribution partner.
    function previewBid(
        uint256 relBid,
        uint256 _refSpot,
        bytes[] memory _oracleData
    )
        external
        view
        returns (DataTypes.BidPreview memory preview, address distPartner);

    /// @notice Returns the current ask of the auction in percentage of notional.
    /// @return Current ask percentage.
    function currAsk() external view returns (uint64);
}
