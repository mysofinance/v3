// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Escrow} from "./Escrow.sol";
import {DataTypes} from "./DataTypes.sol";

contract Router {
    using SafeERC20 for IERC20Metadata;

    address public immutable escrowImpl;
    uint256 public numEscrows;

    mapping(address => bool) public isEscrow;
    mapping(bytes32 => bool) public isQuoteUsed;

    constructor(address _escrowImpl) {
        escrowImpl = _escrowImpl;
    }

    function startAuction(DataTypes.AuctionInfo calldata auctionInfo) external {
        address escrow = _createEscrow(msg.sender);
        Escrow(escrow).initializeAuction(auctionInfo);
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
        address newEscrow = _createEscrow(msg.sender);
        Escrow(newEscrow).initializeAuction(auctionInfo);
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
        ) = Escrow(escrow).handleAuctionBid(
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
            .handleOptionExercise(
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

    function takeQuote(DataTypes.Quote calldata quote) external {
        if (block.timestamp > quote.validUntil) {
            revert();
        }
        bytes32 msgHash = keccak256(
            abi.encode(
                block.chainid,
                quote.underlyingToken,
                quote.settlementToken,
                quote.notional,
                quote.strike,
                quote.expiry,
                quote.premium,
                quote.validUntil
            )
        );
        if (isQuoteUsed[msgHash]) {
            revert();
        }
        address quoter = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(msgHash),
            quote.signature
        );
        isQuoteUsed[msgHash] = true;
        address escrow = _createEscrow(msg.sender);
        Escrow(escrow).initializeRFQMatch(quoter, quote);
        IERC20Metadata(quote.underlyingToken).safeTransferFrom(
            quoter,
            msg.sender,
            quote.premium
        );
    }

    function _createEscrow(address _owner) internal returns (address) {
        address escrow = Clones.cloneDeterministic(
            escrowImpl,
            keccak256(abi.encode(numEscrows))
        );
        numEscrows += 1;
        isEscrow[escrow] = true;
        Escrow(escrow).initialize(address(this), _owner);
        return escrow;
    }
}
