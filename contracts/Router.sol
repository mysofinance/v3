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

    function startAuction(
        address owner,
        DataTypes.AuctionInitialization calldata auctionInitialization
    ) external {
        address escrow = _createEscrow();
        Escrow(escrow).initializeAuction(
            address(this),
            owner,
            auctionInitialization
        );
        IERC20Metadata(auctionInitialization.underlyingToken).safeTransferFrom(
            msg.sender,
            escrow,
            auctionInitialization.notional
        );
    }

    function withdrawFromEscrowAndStartAuction(
        address oldEscrow,
        address owner,
        DataTypes.AuctionInitialization calldata auctionInitialization
    ) external {
        if (!isEscrow[oldEscrow]) {
            revert();
        }
        if (msg.sender != Escrow(oldEscrow).owner()) {
            revert();
        }
        Escrow(oldEscrow).handleWithdraw(
            msg.sender,
            auctionInitialization.underlyingToken,
            IERC20Metadata(auctionInitialization.underlyingToken).balanceOf(
                oldEscrow
            )
        );
        address newEscrow = _createEscrow();
        Escrow(newEscrow).initializeAuction(
            address(this),
            owner,
            auctionInitialization
        );
        IERC20Metadata(auctionInitialization.underlyingToken).safeTransferFrom(
            msg.sender,
            newEscrow,
            auctionInitialization.notional
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

    function takeQuote(
        address owner,
        DataTypes.RFQInitialization calldata rfqInitialization
    ) external {
        DataTypes.TakeQuotePreview memory preview = previewTakeQuote(
            rfqInitialization
        );

        if (preview.status != DataTypes.RFQStatus.Success) {
            revert();
        }

        isQuoteUsed[preview.msgHash] = true;

        address escrow = _createEscrow();
        Escrow(escrow).initializeRFQMatch(
            address(this),
            owner,
            preview.quoter,
            rfqInitialization
        );

        IERC20Metadata(rfqInitialization.optionInfo.underlyingToken)
            .safeTransferFrom(
                preview.quoter,
                msg.sender,
                rfqInitialization.rfqQuote.premium
            );
    }

    function previewTakeQuote(
        DataTypes.RFQInitialization calldata rfqInitialization
    ) public view returns (DataTypes.TakeQuotePreview memory) {
        bytes32 msgHash = keccak256(
            abi.encode(
                block.chainid,
                rfqInitialization.optionInfo.underlyingToken,
                rfqInitialization.optionInfo.settlementToken,
                rfqInitialization.optionInfo.notional,
                rfqInitialization.optionInfo.strike,
                rfqInitialization.optionInfo.expiry,
                rfqInitialization.rfqQuote.premium,
                rfqInitialization.rfqQuote.validUntil
            )
        );

        address quoter = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(msgHash),
            rfqInitialization.rfqQuote.signature
        );

        if (block.timestamp > rfqInitialization.rfqQuote.validUntil) {
            return
                DataTypes.TakeQuotePreview({
                    status: DataTypes.RFQStatus.Expired,
                    msgHash: msgHash,
                    quoter: quoter
                });
        }

        if (isQuoteUsed[msgHash]) {
            return
                DataTypes.TakeQuotePreview({
                    status: DataTypes.RFQStatus.AlreadyExecuted,
                    msgHash: msgHash,
                    quoter: quoter
                });
        }

        uint256 balance = IERC20Metadata(
            rfqInitialization.optionInfo.settlementToken
        ).balanceOf(quoter);

        if (balance < rfqInitialization.rfqQuote.premium) {
            return
                DataTypes.TakeQuotePreview({
                    status: DataTypes.RFQStatus.InsufficientFunding,
                    msgHash: msgHash,
                    quoter: quoter
                });
        }

        return
            DataTypes.TakeQuotePreview({
                status: DataTypes.RFQStatus.Success,
                msgHash: msgHash,
                quoter: quoter
            });
    }

    function _createEscrow() internal returns (address) {
        address escrow = Clones.cloneDeterministic(
            escrowImpl,
            keccak256(abi.encode(numEscrows))
        );
        numEscrows += 1;
        isEscrow[escrow] = true;
        return escrow;
    }
}
