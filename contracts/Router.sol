// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Escrow} from "./Escrow.sol";
import {DataTypes} from "./DataTypes.sol";

contract Router {
    using SafeERC20 for IERC20Metadata;

    address public immutable escrowImpl;
    uint256 public numEscrows;

    mapping(address => bool) public isEscrow;

    constructor(address _escrowImpl) {
        escrowImpl = _escrowImpl;
    }

    function startAuction(DataTypes.AuctionInfo calldata auctionInfo) external {
        address escrow = _createEscrow(auctionInfo);
        IERC20Metadata(auctionInfo.tokenInfo.underlyingToken).safeTransferFrom(
            msg.sender,
            escrow,
            auctionInfo.pricingInfo.notional
        );
    }

    function withdrawFromEscrowAndStartAuction(
        address oldEscrow,
        DataTypes.AuctionInfo calldata auctionInfo
    ) external {
        if (!isEscrow[oldEscrow]) {
            revert();
        }
        if (msg.sender != Escrow(oldEscrow).owner()) {
            revert();
        }
        Escrow(oldEscrow).handleWithdraw(
            msg.sender,
            auctionInfo.tokenInfo.underlyingToken,
            IERC20Metadata(auctionInfo.tokenInfo.underlyingToken).balanceOf(
                oldEscrow
            )
        );
        address newEscrow = _createEscrow(auctionInfo);
        IERC20Metadata(auctionInfo.tokenInfo.underlyingToken).safeTransferFrom(
            msg.sender,
            newEscrow,
            auctionInfo.pricingInfo.notional
        );
    }

    function bidOnAuction(
        address escrow,
        uint256 relBid,
        uint256 amount,
        address optionReceiver,
        uint256 _refSpot,
        bytes[] memory _data
    )
        external
        returns (
            address settlementToken,
            uint256 _strike,
            uint256 _expiry,
            uint256 _earliestExercise,
            uint256 _premium,
            uint256 _oracleSpotPrice
        )
    {
        if (!isEscrow[escrow]) {
            revert();
        }
        (
            settlementToken,
            _strike,
            _expiry,
            _earliestExercise,
            _premium,
            _oracleSpotPrice
        ) = Escrow(escrow).handleCallBid(
            relBid,
            amount,
            optionReceiver,
            _refSpot,
            _data
        );
        IERC20Metadata(settlementToken).safeTransferFrom(
            msg.sender,
            Escrow(escrow).owner(),
            _premium
        );
    }

    function exerciseCall(
        address escrow,
        address underlyingReceiver,
        uint256 underlyingAmount
    ) external {
        if (!isEscrow[escrow]) {
            revert();
        }
        (address settlementToken, uint256 settlementAmount) = Escrow(escrow)
            .handleCallExercise(
                msg.sender,
                underlyingReceiver,
                underlyingAmount
            );
        IERC20Metadata(settlementToken).safeTransferFrom(
            msg.sender,
            Escrow(escrow).owner(),
            settlementAmount
        );
    }

    function borrow(
        address escrow,
        address underlyingReceiver,
        uint256 borrowUnderlyingAmount
    ) external {
        if (!isEscrow[escrow]) {
            revert();
        }
        (address settlementToken, uint256 collateralAmount) = Escrow(escrow)
            .handleBorrow(
                msg.sender,
                underlyingReceiver,
                borrowUnderlyingAmount
            );
        IERC20Metadata(settlementToken).safeTransferFrom(
            msg.sender,
            escrow,
            collateralAmount
        );
    }

    function repay(
        address escrow,
        address collateralReceiver,
        uint256 repayUnderlyingAmount
    ) external {
        if (!isEscrow[escrow]) {
            revert();
        }
        (address underlyingToken, ) = Escrow(escrow).handleRepay(
            msg.sender,
            collateralReceiver,
            repayUnderlyingAmount
        );
        IERC20Metadata(underlyingToken).safeTransferFrom(
            msg.sender,
            escrow,
            repayUnderlyingAmount
        );
    }

    function takeOffer() external /* for RFQ */
    /*underlyingToken, settlementToken, notional, strike, expiry, premium, signature, validUntil*/ {
        //address escrow = _createEscrow(auctionInfo);
        //safeTransferFrom(quoter, msg.sender, premium)
    }

    function _createEscrow(
        DataTypes.AuctionInfo calldata auctionInfo
    ) internal returns (address) {
        address escrow = Clones.cloneDeterministic(
            escrowImpl,
            keccak256(abi.encode(numEscrows))
        );
        numEscrows += 1;
        isEscrow[escrow] = true;
        Escrow(escrow).initialize(address(this), auctionInfo);
        return escrow;
    }
}
