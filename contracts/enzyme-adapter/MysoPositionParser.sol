// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IExternalPositionParser} from "./IExternalPositionParser.sol";
import {IMysoPosition} from "./IMysoPosition.sol";
import {AddressArrayLib} from "./utils/AddressArrayLib.sol";
import {DataTypes} from "../DataTypes.sol";
import {Escrow} from "../Escrow.sol";

/// @title MysoPositionParser
/// @dev Parses Myso Position contract interactions
contract MysoPositionParser is IExternalPositionParser {
    using AddressArrayLib for address[];

    constructor() {}

    /// @notice Parses assets for MysoPosition actions
    /// @param _actionId The action identifier
    /// @param _encodedActionArgs The encoded parameters for the action
    /// @return assetsToSend_ The assets to be sent from the vault
    /// @return amountsToSend_ The amounts to be sent from the vault
    /// @return assetsToReceive_ The assets to be received to the vault
    function parseAssetsForAction(
        address /*_externalPosition*/,
        uint256 _actionId,
        bytes memory _encodedActionArgs
    )
        external
        view
        override
        returns (
            address[] memory assetsToSend_,
            uint256[] memory amountsToSend_,
            address[] memory assetsToReceive_
        )
    {
        if (
            _actionId ==
            uint256(IMysoPosition.Actions.CreateEscrowByTakingQuote)
        ) {
            (
                assetsToSend_,
                amountsToSend_
            ) = __decodeCreateEscrowByTakingQuote({
                _actionArgs: abi.decode(
                    _encodedActionArgs,
                    (IMysoPosition.CreateEscrowByTakingQuoteActionArgs)
                )
            });
        } else if (
            _actionId ==
            uint256(IMysoPosition.Actions.CreateEscrowByStartingAuction)
        ) {
            (
                assetsToSend_,
                amountsToSend_
            ) = __decodeCreateEscrowByStartingAuction({
                _actionArgs: abi.decode(
                    _encodedActionArgs,
                    (IMysoPosition.CreateEscrowByStartingAuctionActionArgs)
                )
            });
        } else if (
            _actionId == uint256(IMysoPosition.Actions.CloseAndSweepEscrow)
        ) {
            assetsToReceive_ = __decodeCloseAndSweepEscrows({
                _actionArgs: abi.decode(
                    _encodedActionArgs,
                    (IMysoPosition.CloseAndSweepEscrowActionArgs)
                )
            });
        } else if (
            _actionId == uint256(IMysoPosition.Actions.WithdrawStuckTokens)
        ) {
            assetsToReceive_ = __decodeWithdrawStuckTokens({
                _actionArgs: abi.decode(
                    _encodedActionArgs,
                    (IMysoPosition.WithdrawStuckTokensActionArgs)
                )
            });
        } else {
            revert("parseAssetsForAction: Invalid actionId");
        }
    }

    /// @notice Parse and validate input arguments to be used when initializing a
    /// newly-deployed ExternalPositionProxy
    /// @dev Nothing to initialize for this MYSO v3 external position type
    function parseInitArgs(
        address,
        bytes memory
    ) external override returns (bytes memory) {}

    function __decodeCloseAndSweepEscrows(
        IMysoPosition.CloseAndSweepEscrowActionArgs memory _actionArgs
    ) internal view returns (address[] memory assetsToReceive_) {
        for (uint256 i = 0; i < _actionArgs.escrows.length; i++) {
            // @dev: retrieve relevant token addresses for sweeping
            (
                address underlyingToken,
                ,
                address settlementToken,
                ,
                ,
                ,

            ) = Escrow(_actionArgs.escrows[i]).optionInfo();
            // @dev: ensure uniqueness using AddressArrayLib
            assetsToReceive_ = assetsToReceive_.addUniqueItem({
                _itemToAdd: underlyingToken
            });
            assetsToReceive_ = assetsToReceive_.addUniqueItem({
                _itemToAdd: settlementToken
            });
        }
        return assetsToReceive_;
    }

    function __decodeCreateEscrowByTakingQuote(
        IMysoPosition.CreateEscrowByTakingQuoteActionArgs memory _actionArgs
    ) internal pure returns (address[] memory, uint256[] memory) {
        address[] memory assets_ = new address[](1);
        uint256[] memory amounts_ = new uint256[](1);

        // @dev: asset to be sent is the underlying token and amount
        // the given notional
        assets_[0] = _actionArgs.rfqInitialization.optionInfo.underlyingToken;
        amounts_[0] = _actionArgs.rfqInitialization.optionInfo.notional;
        return (assets_, amounts_);
    }

    function __decodeCreateEscrowByStartingAuction(
        IMysoPosition.CreateEscrowByStartingAuctionActionArgs memory _actionArgs
    ) internal pure returns (address[] memory, uint256[] memory) {
        address[] memory assets_ = new address[](1);
        uint256[] memory amounts_ = new uint256[](1);

        // @dev: asset to be sent is the underlying token and amount
        // the given notional
        assets_[0] = _actionArgs.auctionInitialization.underlyingToken;
        amounts_[0] = _actionArgs.auctionInitialization.notional;
        return (assets_, amounts_);
    }

    function __decodeWithdrawStuckTokens(
        IMysoPosition.WithdrawStuckTokensActionArgs memory _actionArgs
    ) internal pure returns (address[] memory assetsToReceive_) {
        for (uint256 i = 0; i < _actionArgs.tokens.length; i++) {
            // @dev: retrieve unique assets
            assetsToReceive_ = assetsToReceive_.addUniqueItem({
                _itemToAdd: _actionArgs.tokens[i]
            });
        }
    }
}
