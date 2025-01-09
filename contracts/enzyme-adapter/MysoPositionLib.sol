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

    uint256 private _numEscrows;
    address[] private _escrows;
    address[] private _assets;
    mapping(address => bool) _isAsset;
    mapping(address => uint256) _assetIdx;

    constructor(address _mysoRouter) {
        require(_mysoRouter != address(0), "Invalid router address");
        MYSO_ROUTER = _mysoRouter;
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
        numAssets = _addAssetIfNotExists(
            rfqInitialization.optionInfo.underlyingToken,
            numAssets
        );

        // Add settlement token if not already in the list
        numAssets = _addAssetIfNotExists(
            rfqInitialization.optionInfo.settlementToken,
            numAssets
        );

        _numEscrows += 1;

        IRouter(MYSO_ROUTER).takeQuote(
            msg.sender,
            rfqInitialization,
            address(0)
        );

        uint256 lastEscrowIdx = IRouter(MYSO_ROUTER).numEscrows();
        address[] memory newEscrowAddr = IRouter(MYSO_ROUTER).getEscrows(
            lastEscrowIdx - 1,
            1
        );
        _escrows.push(newEscrowAddr[0]);
        emit EscrowAdded(newEscrowAddr[0]);
    }

    /// @notice Creates a new auction to write an option
    /// @param actionArgs Encoded arguments containing auction initialization data
    function __createAuction(bytes memory actionArgs) private {
        DataTypes.AuctionInitialization memory auctionInitialization = abi
            .decode(actionArgs, (DataTypes.AuctionInitialization));

        IRouter(MYSO_ROUTER).createAuction(
            msg.sender,
            auctionInitialization,
            address(0)
        );
    }

    /// @notice Withdraws tokens from an escrow
    /// @param actionArgs Encoded arguments containing escrow address, token address, and amount
    function __withdraw(bytes memory actionArgs) private {
        (address escrow, address token, uint256 amount) = abi.decode(
            actionArgs,
            (address, address, uint256)
        );
        IRouter(MYSO_ROUTER).withdraw(escrow, msg.sender, token, amount);
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

        for (uint256 i; i < _escrows.length; i++) {
            (
                address underlyingToken,
                address settlementToken
            ) = _getTokensFromOptionInfo(_escrows[i]);
            amounts_[_assetIdx[underlyingToken]] += IERC20Metadata(
                underlyingToken
            ).balanceOf(_escrows[i]);
            amounts_[_assetIdx[settlementToken]] += IERC20Metadata(
                settlementToken
            ).balanceOf(_escrows[i]);
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

    function getManagedAssetsForEscrows(
        uint256 from,
        uint256 numElements
    )
        external
        view
        returns (address[] memory assets_, uint256[] memory amounts_)
    {
        uint256 length = _escrows.length;
        require(
            numElements != 0 && from + numElements <= length,
            "Invalid from or numElements"
        );

        assets_ = _assets;
        amounts_ = new uint256[](_assets.length);

        for (uint256 i; i < numElements; i++) {
            (
                address underlyingToken,
                address settlementToken
            ) = _getTokensFromOptionInfo(_escrows[i]);
            amounts_[_assetIdx[underlyingToken]] += IERC20Metadata(
                underlyingToken
            ).balanceOf(_escrows[from + i]);
            amounts_[_assetIdx[settlementToken]] += IERC20Metadata(
                settlementToken
            ).balanceOf(_escrows[from + i]);
        }

        return (assets_, amounts_);
    }

    ///////////////////
    // STATE GETTERS //
    ///////////////////

    /// @notice Retrieves the number of escrows
    /// @return The total number of escrows managed by this contract
    function getNumEscrows() public view returns (uint256) {
        return _numEscrows;
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
            "Invalid from or numElements"
        );

        _escrowArray = new address[](numElements);
        for (uint256 i = 0; i < numElements; ++i) {
            _escrowArray[i] = _escrows[from + i];
        }
    }

    /// @notice Retrieves withdrawal states of escrows within the specified range
    /// @param from Starting index
    /// @param numElements Number of escrows to check
    /// @return _isWithdrawableArray List of withdrawal states
    function getEscrowStates(
        uint256 from,
        uint256 numElements
    ) external view returns (bool[] memory _isWithdrawableArray) {
        uint256 length = _escrows.length;
        require(
            numElements != 0 && from + numElements <= length,
            "Invalid from or numElements"
        );

        _isWithdrawableArray = new bool[](numElements);
        for (uint256 i = 0; i < numElements; ++i) {
            bool isOptionMinted = Escrow(_escrows[from + i]).optionMinted();
            if (isOptionMinted) {
                uint256 expiry = _getExpiryFromOptionInfo(_escrows[i]);
                _isWithdrawableArray[i] = block.timestamp > expiry;
            }
        }
    }

    //////////////////////
    // INTERNAL HELPERS //
    //////////////////////

    /// @notice Adds a token to the assets list if not already present
    /// @param token Address of the token to add
    /// @param numAssets Current number of assets
    /// @return Updated number of assets
    function _addAssetIfNotExists(
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

    /// @notice Retrieves the underlying and settlement tokens from option info
    /// @param escrow Address of the escrow
    /// @return underlyingToken Address of the underlying token
    /// @return settlementToken Address of the settlement token
    function _getTokensFromOptionInfo(
        address escrow
    ) internal view returns (address underlyingToken, address settlementToken) {
        (underlyingToken, , settlementToken, , , , ) = Escrow(escrow)
            .optionInfo();
    }

    /// @notice Retrieves the expiry timestamp from option info
    /// @param escrow Address of the escrow
    /// @return expiry Expiry timestamp of the option
    function _getExpiryFromOptionInfo(
        address escrow
    ) internal view returns (uint256 expiry) {
        (, expiry, , , , , ) = Escrow(escrow).optionInfo();
    }
}
