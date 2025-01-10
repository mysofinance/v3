// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {DataTypes} from "../DataTypes.sol";
import {Escrow} from "../Escrow.sol";
import {IRouter} from "../interfaces/IRouter.sol";
import {IMysoPosition} from "./IMysoPosition.sol";

contract MysoPositionLib is IMysoPosition {
    using SafeERC20 for IERC20Metadata;

    address private immutable MYSO_ROUTER;

    address[] private _escrows;
    address[] private _assets;
    mapping(address => bool) private _isAsset;
    mapping(address => uint256) private _assetIdx;

    constructor(address mysoRouter) {
        require(mysoRouter != address(0), "Invalid router address");
        MYSO_ROUTER = mysoRouter;
    }

    /// @notice Initializes the external position
    /// @dev Nothing to initialize for this contract
    function init(bytes memory) external override {}

    /// @notice Receives and executes a call from the Vault
    /// @param _actionData Encoded data to execute the action
    function receiveCallFromVault(bytes memory _actionData) external override {
        (uint256 actionId, bytes memory actionArgs) = abi.decode(
            _actionData,
            (uint256, bytes)
        );

        if (actionId == uint256(Actions.TakeQuote)) {
            __takeQuote(actionArgs);
        } else if (actionId == uint256(Actions.CreateAuction)) {
            __createAuction(actionArgs);
        } else if (actionId == uint256(Actions.Withdraw)) {
            __withdraw(actionArgs);
        } else {
            revert("receiveCallFromVault: Invalid actionId");
        }
    }

    /// @notice Takes a quote and writes an option
    /// @param actionArgs Encoded arguments containing RFQ initialization data
    function __takeQuote(bytes memory actionArgs) private {
        DataTypes.RFQInitialization memory rfqInitialization = abi.decode(
            actionArgs,
            (DataTypes.RFQInitialization)
        );

        uint256 numAssets = _assets.length;

        // Add underlying token if not already in the list
        numAssets = _addAsset(
            rfqInitialization.optionInfo.underlyingToken,
            numAssets
        );

        // Add settlement token if not already in the list
        numAssets = _addAsset(
            rfqInitialization.optionInfo.settlementToken,
            numAssets
        );

        // @dev: set External Position (EP) as escrow owner
        IRouter(MYSO_ROUTER).takeQuote(
            address(this),
            rfqInitialization,
            address(0)
        );

        _addLatestEscrow();
    }

    /// @notice Creates a new auction to write an option
    /// @param actionArgs Encoded arguments containing auction initialization data
    function __createAuction(bytes memory actionArgs) private {
        DataTypes.AuctionInitialization memory auctionInitialization = abi
            .decode(actionArgs, (DataTypes.AuctionInitialization));

        IERC20Metadata(auctionInitialization.underlyingToken).transferFrom(
            msg.sender,
            address(this),
            auctionInitialization.notional
        );
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

        _addLatestEscrow();
    }

    /// @notice Withdraws tokens from escrows
    /// @param actionArgs Encoded arguments containing escrow addresses, token addresses, and amounts
    function __withdraw(bytes memory actionArgs) private {
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
        assets_ = _assets;
        amounts_ = new uint256[](_assets.length);

        // @dev: bounding of escrow length intentionally skipped
        for (uint256 i; i < _escrows.length; i++) {
            address _escrow = _escrows[i];

            require(
                allowNavCalculation(_escrow),
                "getManagedAssets: NAV calculation disallowed"
            );

            (
                address underlyingToken,
                ,
                address settlementToken,
                ,
                ,
                ,

            ) = Escrow(_escrow).optionInfo();
            amounts_[_assetIdx[underlyingToken]] += IERC20Metadata(
                underlyingToken
            ).balanceOf(_escrow);
            amounts_[_assetIdx[settlementToken]] += IERC20Metadata(
                settlementToken
            ).balanceOf(_escrow);
        }

        return (assets_, amounts_);
    }

    function getDebtAssets()
        external
        view
        override
        returns (address[] memory assets_, uint256[] memory amounts_)
    {
        assets_ = _assets;
        amounts_ = new uint256[](_assets.length);
        return (assets_, amounts_);
    }

    ///////////////////
    // STATE GETTERS //
    ///////////////////

    /// @notice Retrieves the number of escrows
    /// @return The total number of escrows managed by this contract
    function getNumEscrows() external view returns (uint256) {
        return _escrows.length;
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
            numElements != 0 && from + numElements <= length,
            "getEscrowAddresses: Invalid range"
        );

        _escrowArray = new address[](numElements);
        for (uint256 i = 0; i < numElements; ++i) {
            _escrowArray[i] = _escrows[from + i];
        }
    }

    function allowNavCalculation(address escrow) public view returns (bool) {
        // @dev: note if there's an unmatched/in progress auction
        // (=no minted option) then we disallow NAV calculation
        // to automatically prevent deposits during this time
        // that otherwise could potentially dilute early depositors
        if (!Escrow(escrow).optionMinted()) {
            return false;
        }

        // @dev: two cases where we support NAV calculation

        // case 1 - option was exercised: this is the case if
        // option minted but option supply is 0 (and no open borrows)
        if (
            IERC20Metadata(escrow).totalSupply() == 0 &&
            Escrow(escrow).totalBorrowed() == 0
        ) {
            return true;
        }

        // case 2 - option expired unexercised: this is the
        // case if option minted but expired
        (, uint256 expiry, , , , , ) = Escrow(escrow).optionInfo();
        if (block.timestamp > expiry) {
            return true;
        }

        return false;
    }

    //////////////////////
    // INTERNAL HELPERS //
    //////////////////////

    /// @notice Adds a token to the assets list if not already present
    /// @param token Address of the token to add
    /// @param numAssets Current number of assets
    /// @return Updated number of assets
    function _addAsset(
        address token,
        uint256 numAssets
    ) internal returns (uint256) {
        if (!_isAsset[token]) {
            _isAsset[token] = true;
            _assets.push(token);

            numAssets += 1;

            _assetIdx[token] = numAssets - 1;
            emit AssetAdded(token);
        }
        return numAssets;
    }

    function _addLatestEscrow() internal {
        uint256 numEscrows = IRouter(MYSO_ROUTER).numEscrows();
        if (numEscrows > 0) {
            address[] memory newEscrowAddr = IRouter(MYSO_ROUTER).getEscrows(
                numEscrows - 1,
                1
            );

            // @dev: bounding of escrow length intentionally skipped
            _escrows.push(newEscrowAddr[0]);

            emit EscrowAdded(newEscrowAddr[0]);
        }
    }
}
