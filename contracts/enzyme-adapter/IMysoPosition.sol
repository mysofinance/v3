// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IExternalPosition} from "./IExternalPosition.sol";

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
        TakeQuote,
        CreateAuction,
        CloseAndSweep,
        Withdraw
    }
}
