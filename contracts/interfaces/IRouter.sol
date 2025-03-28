// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {DataTypes} from "../DataTypes.sol";

/// @title IRouter
/// @notice Interface for the Router contract handling auction creation, bidding, exercising, and other related functionalities
interface IRouter {
    /// @notice Emitted when a new auction is created
    /// @param escrowOwner The address of the escrow owner
    /// @param escrow The address of the created escrow contract
    /// @param auctionInitialization The initialization data for the auction
    /// @param exerciseFee The applicable exercise fee
    /// @param distPartner The distribution partner's address
    event CreateAuction(
        address indexed escrowOwner,
        address indexed escrow,
        DataTypes.AuctionInitialization auctionInitialization,
        uint96 exerciseFee,
        address distPartner
    );

    /// @notice Emitted when a withdrawal from escrow occurs and a new auction is created
    /// @param escrowOwner The address of the escrow owner
    /// @param oldEscrow The address of the old escrow
    /// @param newEscrow The address of the new escrow
    /// @param auctionInitialization The initialization data for the auction
    event WithdrawFromEscrowAndCreateAuction(
        address indexed escrowOwner,
        address indexed oldEscrow,
        address indexed newEscrow,
        DataTypes.AuctionInitialization auctionInitialization
    );

    /// @notice Emitted when a withdrawal is made from an escrow
    /// @param sender The address initiating the withdrawal
    /// @param escrow The escrow address from which withdrawal occurs
    /// @param to The address receiving the withdrawn tokens
    /// @param token The token address being withdrawn
    /// @param amount The amount of tokens withdrawn
    event Withdraw(
        address indexed sender,
        address indexed escrow,
        address to,
        address indexed token,
        uint256 amount
    );

    /// @notice Emitted when a bid is placed on an auction
    /// @param sender The address initiating the bid
    /// @param escrow The address of the escrow on which the bid is placed
    /// @param optionReceiver The address receiving the option
    /// @param bidPreview The bid preview
    /// @param distPartner The distribution partner's address
    event BidOnAuction(
        address indexed sender,
        address indexed escrow,
        address optionReceiver,
        DataTypes.BidPreview bidPreview,
        address indexed distPartner
    );

    /// @notice Emitted when an exercise occurs on an option
    /// @param sender The address initiating the exercise
    /// @param escrow The address of the escrow smart contract = option token
    /// @param underlyingReceiver The address receiving the underlying asset
    /// @param underlyingAmount The amount of underlying tokens being exercised
    /// @param exerciseFeeAmount The fee amount for exercising
    event Exercise(
        address indexed sender,
        address indexed escrow,
        address underlyingReceiver,
        uint256 underlyingAmount,
        uint256 exerciseFeeAmount
    );

    /// @notice Emitted when a loan is taken from an escrow
    /// @param sender The address initiating the borrow
    /// @param escrow The address of the escrow providing the loan
    /// @param underlyingReceiver The address receiving the loaned underlying asset
    /// @param underlyingAmount The amount of the loan
    /// @param collateralAmount The amount of collateral provided
    /// @param collateralFeeAmount The fee amount that is deducted from the collateral
    event Borrow(
        address indexed sender,
        address indexed escrow,
        address underlyingReceiver,
        uint128 underlyingAmount,
        uint256 collateralAmount,
        uint256 collateralFeeAmount
    );

    /// @notice Emitted when a repayment is made to an escrow
    /// @param sender The address initiating the repay
    /// @param escrow The address of the escrow receiving the repayment
    /// @param collateralReceiver The address receiving the collateral
    /// @param repayUnderlyingAmount The amount of the underlying asset being repaid
    /// @param unlockedCollateralAmount The amount of collateral being unlocked
    event Repay(
        address indexed sender,
        address indexed escrow,
        address collateralReceiver,
        uint128 repayUnderlyingAmount,
        uint256 unlockedCollateralAmount
    );

    /// @notice Emitted when a quote is taken
    /// @param sender The address initiating the take quote
    /// @param escrowOwner The owner of the escrow
    /// @param escrow The escrow address
    /// @param rfqInitialization The initialization data for the RFQ
    /// @param takeQuotePreview The take quote preview
    /// @param exerciseFee The applicable exercise fee
    /// @param distPartner The distribution partner's address
    event TakeQuote(
        address indexed sender,
        address escrowOwner,
        address indexed escrow,
        DataTypes.RFQInitialization rfqInitialization,
        DataTypes.TakeQuotePreview takeQuotePreview,
        uint96 exerciseFee,
        address indexed distPartner
    );

    /// @notice Emitted when a swap quote is taken
    /// @param sender The address initiating the take swap quote
    /// @param to The address receiving the swapped tokens
    /// @param maker The maker's address providing the swap
    /// @param swapQuote The details of the swap quote
    event TakeSwapQuote(
        address indexed sender,
        address indexed to,
        address indexed maker,
        DataTypes.SwapQuote swapQuote
    );

    /// @notice Emitted when an option is minted
    /// @param sender The address initiating the mint option
    /// @param optionReceiver The address receiving the minted option
    /// @param escrowOwner The owner of the escrow minting the option
    /// @param optionInfo The details of the option being minted
    /// @param mintFeeProtocol The mint fee amount for the protocol
    /// @param mintFeeDistPartner The mint fee amount for the distribution partner
    /// @param distPartner The distribution partner
    event MintOption(
        address indexed sender,
        address indexed optionReceiver,
        address escrowOwner,
        DataTypes.OptionInfo optionInfo,
        uint256 mintFeeProtocol,
        uint256 mintFeeDistPartner,
        address indexed distPartner
    );

    /// @notice Emitted when a new fee handler is set
    /// @param oldFeeHandler The previous fee handler address
    /// @param newFeeHandler The new fee handler address
    event NewFeeHandler(address oldFeeHandler, address newFeeHandler);

    /// @notice Emitted when quote pause status changes
    /// @param quoter The address whose pause status changed
    /// @param isPaused The new pause status
    event PauseQuotes(address indexed quoter, bool isPaused);

    /// @notice Emitted when tokens are transferred between addresses.
    /// @param token The address of the token contract.
    /// @param from The address transferring the tokens.
    /// @param to The address receiving the tokens.
    /// @param value The amount of tokens transferred.
    event Transfer(
        address indexed token,
        address indexed from,
        address indexed to,
        uint256 value
    );

    /// @notice Emitted when ownership of escrow is transferred
    /// @param escrow The address of the escrow contract.
    /// @param oldOwner The address of the old owner.
    /// @param newOwner The address of the new owner.
    event TransferOwnership(
        address indexed escrow,
        address indexed oldOwner,
        address indexed newOwner
    );

    /// @notice Returns the address of the escrow implementation contract.
    /// @return escrowImpl The address of the escrow implementation contract.
    function escrowImpl() external view returns (address);

    /// @notice Returns the address of the fee handler contract.
    /// @return feeHandler The address of the fee handler.
    function feeHandler() external view returns (address);

    /// @notice Returns the total number of escrows created.
    /// @return numEscrows The total number of escrows.
    function numEscrows() external view returns (uint256);

    /// @notice Checks if a specific address is registered as an escrow.
    /// @param escrow The address to check.
    /// @return True if the address is an escrow, false otherwise.
    function isEscrow(address escrow) external view returns (bool);

    /// @notice Checks if a specific quote has been used.
    /// @param quoteHash The hash of the quote.
    /// @return True if the quote has been used, false otherwise.
    function isQuoteUsed(bytes32 quoteHash) external view returns (bool);

    /// @notice Checks if a specific swap quote has been used.
    /// @param swapQuoteHash The hash of the swap quote.
    /// @return True if the swap quote has been used, false otherwise.
    function isSwapQuoteUsed(
        bytes32 swapQuoteHash
    ) external view returns (bool);

    /// @notice Checks if quotes are paused for a specific address.
    /// @param quoter The address to check.
    /// @return True if quotes are paused for the address, false otherwise.
    function quotesPaused(address quoter) external view returns (bool);

    /// @notice Creates a new Dutch auction
    /// @param escrowOwner The address of the escrow owner
    /// @param auctionInitialization The initialization data for the auction
    /// @param distPartner The address of the distribution partner
    function createAuction(
        address escrowOwner,
        DataTypes.AuctionInitialization calldata auctionInitialization,
        address distPartner
    ) external;

    /// @notice Withdraws from an existing escrow and creates a new auction
    /// @param oldEscrow The address of the old escrow
    /// @param escrowOwner The address of the escrow owner
    /// @param auctionInitialization The initialization data for the auction
    /// @param distPartner The address of the distribution partner
    function withdrawFromEscrowAndCreateAuction(
        address oldEscrow,
        address escrowOwner,
        DataTypes.AuctionInitialization calldata auctionInitialization,
        address distPartner
    ) external;

    /// @notice Withdraws tokens from a specified escrow
    /// @param escrow The escrow address from which to withdraw
    /// @param to The address to receive the withdrawn tokens
    /// @param token The token to be withdrawn
    /// @param amount The amount of tokens to withdraw
    function withdraw(
        address escrow,
        address to,
        address token,
        uint256 amount
    ) external;

    /// @notice Places a bid on an auction
    /// @param escrow The escrow address for the auction
    /// @param optionReceiver The address to receive the option
    /// @param relBid The relative bid in percentage of notional
    /// @param refSpot The reference spot price
    /// @param oracleData Additional optional oracle data for validation
    /// @return preview The bid preview data
    /// @return distPartner The distribution partner
    function bidOnAuction(
        address escrow,
        address optionReceiver,
        uint256 relBid,
        uint256 refSpot,
        bytes[] memory oracleData
    )
        external
        returns (DataTypes.BidPreview memory preview, address distPartner);

    /// @notice Exercises an option in an escrow
    /// @param escrow The escrow address holding the option
    /// @param underlyingReceiver The address receiving the underlying asset
    /// @param underlyingAmount The amount of the underlying asset exercised
    /// @param payInSettlementToken Whether payment is in the settlement token
    /// @param oracleData Additional optional oracle data for validation
    function exercise(
        address escrow,
        address underlyingReceiver,
        uint256 underlyingAmount,
        bool payInSettlementToken,
        bytes[] memory oracleData
    ) external;

    /// @notice Borrows underlying tokens from an escrow
    /// @param escrow The escrow address providing the loan
    /// @param underlyingReceiver The address to receive the loaned tokens
    /// @param borrowUnderlyingAmount The amount of the loan
    function borrow(
        address escrow,
        address underlyingReceiver,
        uint128 borrowUnderlyingAmount
    ) external;

    /// @notice Repays a loan to an escrow
    /// @param escrow The escrow address receiving the repayment
    /// @param collateralReceiver The address to receive collateral
    /// @param repayUnderlyingAmount The amount of the underlying asset repaid
    function repay(
        address escrow,
        address collateralReceiver,
        uint128 repayUnderlyingAmount
    ) external;

    /// @notice Takes an RFQ quote
    /// @param escrowOwner The address of the escrow owner
    /// @param rfqInitialization The initialization data for the RFQ
    /// @param distPartner The distribution partner's address
    function takeQuote(
        address escrowOwner,
        DataTypes.RFQInitialization calldata rfqInitialization,
        address distPartner
    ) external;

    /// @notice Takes a swap quote
    /// @param to The address to receive the swapped tokens
    /// @param swapQuote The swap quote details
    function takeSwapQuote(
        address to,
        DataTypes.SwapQuote calldata swapQuote
    ) external;

    /// @notice Toggles the pause status of quotes for the sender
    function togglePauseQuotes() external;

    /// @notice Mints a new option
    /// @param optionReceiver The address to receive the minted option
    /// @param escrowOwner The owner of the escrow minting the option
    /// @param optionInfo The details of the option being minted
    /// @param optionNaming The name and symbol of the option being minted
    /// @param distPartner The distribution partner's address
    function mintOption(
        address optionReceiver,
        address escrowOwner,
        DataTypes.OptionInfo calldata optionInfo,
        DataTypes.OptionNaming calldata optionNaming,
        address distPartner
    ) external;

    /// @notice Sets a new fee handler address
    /// @param newFeeHandler The new fee handler address
    function setFeeHandler(address newFeeHandler) external;

    /// @notice Retrieves the current exercise fee
    /// @return exerciseFee The current exercise fee as a `uint96`
    function getExerciseFee() external view returns (uint96 exerciseFee);

    /// @notice Returns the match fee and distribution partner fee share for a given option match.
    /// @param distPartner The address of the distribution partner.
    /// @param optionPremium The given option premium.
    /// @param optionInfo The given option info.
    /// @return matchFeeProtocol The protocol's match fee
    /// @return matchFeeDistPartner The distribution partner's match fee
    function getMatchFees(
        address distPartner,
        uint128 optionPremium,
        DataTypes.OptionInfo calldata optionInfo
    )
        external
        view
        returns (uint128 matchFeeProtocol, uint128 matchFeeDistPartner);

    /// @notice Calculates mint fees for a given distribution partner and notional
    /// @param distPartner The distribution partner's address
    /// @param notional The notional of the option in underlying token units
    /// @return mintFeeProtocol The protocol's mint fee in option tokens
    /// @return mintFeeDistPartner The distribution partner's mint fee in option tokens
    function getMintFees(
        address distPartner,
        uint128 notional
    )
        external
        view
        returns (uint256 mintFeeProtocol, uint256 mintFeeDistPartner);

    /// @notice Previews the result of taking a quote
    /// @param rfqInitialization The initialization data for the RFQ
    /// @param distPartner The distribution partner's address
    /// @return A preview of the quote as a `TakeQuotePreview` struct
    function previewTakeQuote(
        DataTypes.RFQInitialization calldata rfqInitialization,
        address distPartner
    ) external view returns (DataTypes.TakeQuotePreview memory);

    /// @notice Retrieves a range of escrows
    /// @param from The starting index of escrows to retrieve
    /// @param numElements The number of escrows to retrieve
    /// @return _escrows An array of escrow addresses
    function getEscrows(
        uint256 from,
        uint256 numElements
    ) external view returns (address[] memory _escrows);

    /// @notice Emits a `Transfer` event for a token.
    /// @dev Callable only by registered escrows. Reverts if not an escrow.
    /// @param from Address sending the tokens.
    /// @param to Address receiving the tokens.
    /// @param value Amount of tokens transferred.
    function emitTransferEvent(
        address from,
        address to,
        uint256 value
    ) external;

    /// @notice Emits a `TransferOwnership` event for an escrow contract.
    /// @dev Callable only by registered escrows. Reverts if not an escrow.
    /// @param oldOwner Address of the old owner.
    /// @param newOwner Address of the new owner.
    function emitTransferOwnershipEvent(
        address oldOwner,
        address newOwner
    ) external;
}
