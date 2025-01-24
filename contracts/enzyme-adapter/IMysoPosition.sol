// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IExternalPosition} from "./IExternalPosition.sol";
import {DataTypes} from "../DataTypes.sol";

interface IMysoPosition is IExternalPosition {
    event EscrowCreated(
        address indexed escrow,
        address underlyingToken,
        uint256 underlyingAmount,
        bool isAuction
    );
    event EscrowClosedAndSweeped(
        address indexed escrow,
        address underlyingToken,
        uint256 underlyingTokenAmount,
        address settlementToken,
        uint256 settlementTokenAmount
    );
    event WithdrawFromEscrow(
        address indexed escrow,
        address token,
        uint256 amount
    );

    enum Actions {
        CreateEscrowByTakingQuote,
        CreateEscrowByStartingAuction,
        CloseAndSweepEscrow,
        WithdrawStuckTokens
    }

    struct CreateEscrowByTakingQuoteActionArgs {
        DataTypes.RFQInitialization rfqInitialization;
    }

    struct CreateEscrowByStartingAuctionActionArgs {
        DataTypes.AuctionInitialization auctionInitialization;
    }

    struct CloseAndSweepEscrowActionArgs {
        address[] escrows;
    }

    struct WithdrawStuckTokensActionArgs {
        address[] escrows;
        address[] tokens;
        uint256[] amounts;
    }
}
