// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IExternalPosition} from "./IExternalPosition.sol";

interface IMysoPosition is IExternalPosition {
    event AssetAdded(address indexed asset);
    event EscrowAdded(address indexed escrow);

    enum Actions {
        TakeQuote,
        CreateAuction,
        Withdraw
    }
}
