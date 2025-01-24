// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {DataTypes} from "../DataTypes.sol";
import {Escrow} from "../Escrow.sol";
import {IRouter} from "../interfaces/IRouter.sol";
import {IMysoPosition} from "./IMysoPosition.sol";

/**
 * @title MysoPositionLib
 * @dev This contract serves as an external position manager for MYSO V3, enabling the writing of covered calls
 * as an Enzyme vault manager and facilitating their creation and settlement on-chain via escrow contracts.
 * Options can be written by either taking a quote via RFQ or through Dutch auctions.
 *
 * ## Key Functionalities:
 *
 * 1. **Escrow Creation**:
 *    - `__createEscrowByTakingQuote`: Creates an escrow based on an RFQ quote, locking underlying tokens.
 *    - `__createEscrowByStartingAuction`: Initiates an auction-based escrow with defined parameters.
 *
 * 2. **Escrow Lifecycle Management**:
 *    - `__closeAndSweepEscrows`: Closes escrows and retrieves any leftover balances based on auction/exercise status.
 *    - `__withdrawStuckTokens`: Allows withdrawal of potentially stuck or airdropped tokens from escrows.
 *
 * 3. **State Getters**:
 *    - `getManagedAssets`: Retrieves all currently managed assets under the position.
 *    - `getDebtAssets`: Returns a list of debt-related assets (always empty in this implementation).
 *    - `getNumEscrows`: Provides the total count of escrows managed by this contract.
 *    - `getNumOpenEscrows`: Tracks the number of currently active (open) escrows.
 *    - `getEscrowAddresses`: Retrieves escrow addresses based on specified index ranges.
 *    - `isEscrowClosed`: Checks if a specific escrow has been closed.
 *
 * @notice Whenever there are open escrows, the associated asset positions are considered
 * non-deterministic. Therefore, related NAV calculations are not supported in this version.
 * Vault managers must actively mark escrows as closed to prevent `getManagedAssets` from reverting.
 *
 * This approach simplifies overall asset tracking, as relevant assets are always either:
 * (a) held within the associated Enzyme vault (e.g., when an option is exercised, the conversion amount
 * is automatically sent to the MYSO escrow owner, which in this case is the Enzyme vault), or
 * (b) require sweeping (e.g., when an option is not exercised or only partially exercised,
 * as well as when a trading firm borrows coins, posts collateral, but does not reclaim it).
 */
contract MysoPositionLib is IMysoPosition {
    using SafeERC20 for IERC20Metadata;

    address private immutable MYSO_ROUTER;

    address[] private _escrows;
    uint256 private _numOpenEscrows;
    mapping(address => bool) private _escrowClosed;

    constructor(address mysoRouter) {
        require(mysoRouter != address(0), "Invalid router address");
        MYSO_ROUTER = mysoRouter;
    }

    /// @notice Initializes the external position
    /// @dev Nothing to initialize for this MYSO v3 external position type
    function init(bytes memory) external override {}

    /// @notice Receives and executes a call from the Vault
    /// @param _actionData Encoded data to execute the action
    function receiveCallFromVault(bytes memory _actionData) external override {
        (uint256 actionId, bytes memory actionArgs) = abi.decode(
            _actionData,
            (uint256, bytes)
        );

        if (actionId == uint256(Actions.CreateEscrowByTakingQuote)) {
            __createEscrowByTakingQuote(actionArgs);
        } else if (actionId == uint256(Actions.CreateEscrowByStartingAuction)) {
            __createEscrowByStartingAuction(actionArgs);
        } else if (actionId == uint256(Actions.CloseAndSweepEscrow)) {
            __closeAndSweepEscrows(actionArgs);
        } else if (actionId == uint256(Actions.WithdrawStuckTokens)) {
            __withdrawStuckTokens(actionArgs);
        } else {
            revert("receiveCallFromVault: Invalid actionId");
        }
    }

    /// @notice Creates an escrow by taking a quote and writing an option
    /// @param actionArgs Encoded arguments containing RFQ initialization data
    function __createEscrowByTakingQuote(bytes memory actionArgs) private {
        DataTypes.RFQInitialization memory rfqInitialization = abi.decode(
            actionArgs,
            (DataTypes.RFQInitialization)
        );

        // @dev: approve router to pull notional amount from this contract
        // note: given notional amount is assumed to have been sent prior to this call
        IERC20Metadata(rfqInitialization.optionInfo.underlyingToken).approve(
            MYSO_ROUTER,
            rfqInitialization.optionInfo.notional
        );

        // @dev: set External Position (EP) as escrow owner
        IRouter(MYSO_ROUTER).takeQuote(
            address(this),
            rfqInitialization,
            address(0)
        );

        // @dev: keep track of escrows and number of open/unsettled escrows
        _addLatestEscrow(
            rfqInitialization.optionInfo.underlyingToken,
            rfqInitialization.optionInfo.notional,
            false
        );
    }

    /// @notice Creates a escrow by starting new auction to write an option
    /// @param actionArgs Encoded arguments containing auction initialization data
    function __createEscrowByStartingAuction(bytes memory actionArgs) private {
        DataTypes.AuctionInitialization memory auctionInitialization = abi
            .decode(actionArgs, (DataTypes.AuctionInitialization));

        // @dev: approve router to pull notional amount from this contract
        // note: given notional amount is assumed to have been sent prior to this call
        IERC20Metadata(auctionInitialization.underlyingToken).approve(
            MYSO_ROUTER,
            auctionInitialization.notional
        );

        // @dev: set External Position (EP) as escrow owner
        IRouter(MYSO_ROUTER).createAuction(
            address(this),
            auctionInitialization,
            address(0)
        );

        // @dev: keep track of escrows and number of open/unsettled escrows
        _addLatestEscrow(
            auctionInitialization.underlyingToken,
            auctionInitialization.notional,
            true
        );
    }

    /// @notice Close open escrows and sweeps any related balances
    /// @param actionArgs Encoded arguments containing escrows to close and sweep
    function __closeAndSweepEscrows(bytes memory actionArgs) private {
        // @dev: vault manager needs to close escrows individually
        // note: high level there are three cases to consider:
        // a) cancel auction: vault manager cancels auction before any match
        // -> vault manager needs to mark escrow as closed; can do that any time before match
        // -> in this case underlying tokens need to be swept
        // b) early "full" exercise: trading firm exercises all option tokens
        // -> vault manager needs to mark escrow as closed; can do that any time
        // -> in this case no tokens need to be swept because conversion is automatically
        // sent to escrow owner / vault manager upon exercise
        // c) in all other cases: trading firm didn't (fully) exercise option
        // -> vault manager needs to mark escrow as closed after expiry
        // -> in this case underlying tokens and settlement tokens need to be swept;
        // underlying tokens may be related to left-overs from only partial exercise;
        // settlement tokens may be related to unclaimed collateral from borrows w/o repay;
        // note: case c) includes following "sub-scenarios":
        // c.i) option expired out-of-the-money: trading firm didn't exercise at all
        // c.ii) partial exercise: trading firm partially exercised
        // c.iii) borrow without repay: trading firm borrowed (part of) underlying but
        // didn't repay before expiry

        address[] memory escrows = abi.decode(actionArgs, (address[]));

        require(
            escrows.length > 0,
            "__closeAndSweepEscrows: Input array must not be empty"
        );
        for (uint256 i = 0; i < escrows.length; i++) {
            // @dev: retrieve relevant token addresses for sweeping
            (
                address underlyingToken,
                uint256 expiry,
                address settlementToken,
                ,
                ,
                ,

            ) = Escrow(escrows[i]).optionInfo();
            uint256 underlyingTokenBalance = IERC20Metadata(underlyingToken)
                .balanceOf(escrows[i]);

            // check case a) - unmatched auction (option not minted yet)
            bool isOptionMinted = Escrow(escrows[i]).optionMinted();
            if (!isOptionMinted) {
                // mark as settled and sweep underlying tokens;
                // settlement tokens can be skipped
                _markAsClosedAndSweepEscrow(
                    escrows[i],
                    underlyingToken,
                    underlyingTokenBalance,
                    settlementToken,
                    0
                );
                continue;
            }

            // check case b) - full exercise iff:
            // option token supply == 0 and total borrows == 0
            uint256 optionTokenSupply = IERC20Metadata(escrows[i])
                .totalSupply();
            uint256 totalBorrowed = Escrow(escrows[i]).totalBorrowed();
            if (optionTokenSupply == 0 && totalBorrowed == 0) {
                // mark as settled; no sweeping needed as conversion amount
                // must've been sent to escrow.owner / vault manager already
                _markAsClosedAndSweepEscrow(
                    escrows[i],
                    underlyingToken,
                    0,
                    settlementToken,
                    0
                );
                continue;
            }

            // check case c) - all other cases:
            // need to check if option already expired; otherwise revert as
            // we cannot withdraw yet
            uint256 settlementTokenBalance = IERC20Metadata(settlementToken)
                .balanceOf(escrows[i]);
            require(
                block.timestamp > expiry,
                "__closeAndSweepEscrow: Option hasn't expired yet"
            );
            _markAsClosedAndSweepEscrow(
                escrows[i],
                underlyingToken,
                underlyingTokenBalance,
                settlementToken,
                settlementTokenBalance
            );
        }
    }

    /// @notice Withdraws potentially stuck tokens from escrows
    /// @param actionArgs Encoded arguments containing escrow addresses, token addresses, and amounts
    function __withdrawStuckTokens(bytes memory actionArgs) private {
        // @dev: allow vault manager to withdraw generic coins if needed
        // note: generic withdrawing will not mark given escrows as closed,
        // in which case getManagedAssets() will continue to fail if given
        // escrows are not explicitly closed via __closeAndSweepEscrow()
        (
            address[] memory escrows,
            address[] memory tokens,
            uint256[] memory amounts
        ) = abi.decode(actionArgs, (address[], address[], uint256[]));

        require(
            escrows.length == tokens.length && tokens.length == amounts.length,
            "__withdraw: Input arrays must have the same length"
        );

        for (uint256 i = 0; i < escrows.length; i++) {
            IRouter(MYSO_ROUTER).withdraw(
                escrows[i],
                msg.sender,
                tokens[i],
                amounts[i]
            );
            emit WithdrawFromEscrow(escrows[i], tokens[i], amounts[i]);
        }
    }

    ////////////////////
    // POSITION VALUE //
    ////////////////////

    /// @notice Retrieves the managed assets (positive value) of the external position
    /// @return assets_ Managed assets
    /// @return amounts_ Managed asset amounts
    function getManagedAssets()
        external
        view
        override
        returns (address[] memory assets_, uint256[] memory amounts_)
    {
        // @dev: check if vault manager has open escrows, in which case fair value
        // calculation is non-deterministic and not supported;
        require(
            _numOpenEscrows == 0,
            "getManagedAssets: Must not have open escrows"
        );
        // else return empty list as all assets are with vault manager already;
        return (new address[](0), new uint256[](0));
    }

    function getDebtAssets()
        external
        pure
        override
        returns (address[] memory assets_, uint256[] memory amounts_)
    {
        // @dev: no debt assets to track
        return (new address[](0), new uint256[](0));
    }

    ///////////////////
    // STATE GETTERS //
    ///////////////////

    /// @notice Retrieves the number of escrows
    /// @return The total number of escrows managed by this contract
    function getNumEscrows() external view returns (uint256) {
        return _escrows.length;
    }

    /// @notice Retrieves the number of open escrows
    /// @return The total number of open escrows managed by this contract
    function getNumOpenEscrows() external view returns (uint256) {
        return _numOpenEscrows;
    }

    /// @notice Retrieves if escrow is closed
    /// @return Boolean flag if escrow is closed
    function isEscrowClosed(address escrow) external view returns (bool) {
        return _escrowClosed[escrow];
    }

    /// @notice Retrieves the escrow addresses within the specified range
    /// @param from Starting index
    /// @param numElements Number of escrow addresses to retrieve
    /// @return _escrowArray List of escrow addresses
    function getEscrowAddresses(
        uint256 from,
        uint256 numElements
    ) external view returns (address[] memory _escrowArray) {
        uint256 length = _escrows.length;
        require(
            numElements > 0 && from + numElements <= length,
            "getEscrowAddresses: Invalid range"
        );

        _escrowArray = new address[](numElements);
        for (uint256 i = 0; i < numElements; ++i) {
            _escrowArray[i] = _escrows[from + i];
        }
    }

    //////////////////////
    // INTERNAL HELPERS //
    //////////////////////

    function _addLatestEscrow(
        address underlyingToken,
        uint256 underlyingAmount,
        bool isAuction
    ) internal {
        uint256 numEscrows = IRouter(MYSO_ROUTER).numEscrows();
        if (numEscrows > 0) {
            // @dev: increment number of open escrows
            _numOpenEscrows += 1;
            // get latest escrow and push to internal list
            address[] memory newEscrowAddr = IRouter(MYSO_ROUTER).getEscrows(
                numEscrows - 1,
                1
            );
            _escrows.push(newEscrowAddr[0]);

            emit EscrowCreated(
                newEscrowAddr[0],
                underlyingToken,
                underlyingAmount,
                isAuction
            );
        }
    }

    function _markAsClosedAndSweepEscrow(
        address escrow,
        address underlyingToken,
        uint256 underlyingTokenBalance,
        address settlementToken,
        uint256 settlementTokenBalance
    ) internal {
        require(
            !_escrowClosed[escrow],
            "_markAsClosedAndSweepEscrow: Escrow already closed"
        );
        // @dev: mark escrow as closed and decrement
        // number of open escrows
        _escrowClosed[escrow] = true;
        _numOpenEscrows -= 1;

        // sweep any underlying token balances
        if (underlyingTokenBalance > 0) {
            IRouter(MYSO_ROUTER).withdraw(
                escrow,
                msg.sender,
                underlyingToken,
                underlyingTokenBalance
            );
        }

        // sweep any settlement token balances
        if (settlementTokenBalance > 0) {
            IRouter(MYSO_ROUTER).withdraw(
                escrow,
                msg.sender,
                settlementToken,
                settlementTokenBalance
            );
        }
        emit EscrowClosedAndSweeped(
            escrow,
            underlyingToken,
            underlyingTokenBalance,
            settlementToken,
            settlementTokenBalance
        );
    }
}
