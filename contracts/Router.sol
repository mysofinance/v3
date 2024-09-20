// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Escrow} from "./Escrow.sol";
import {FeeHandler} from "./FeeHandler.sol";
import {DataTypes} from "./DataTypes.sol";

contract Router is Ownable {
    using SafeERC20 for IERC20Metadata;

    uint256 public constant MAX_FEE = 0.2 ether;
    uint256 public constant BASE = 1 ether;
    address public immutable escrowImpl;
    address public feeHandler;
    uint256 public numEscrows;

    mapping(address => bool) public isEscrow;
    mapping(bytes32 => bool) public isQuoteUsed;
    address[] public escrows;

    event StartAuction(
        address indexed escrowOwner,
        address indexed escrow,
        DataTypes.AuctionInitialization auctionInitialization
    );
    event WithdrawFromEscrowAndStartAuction(
        address indexed escrowOwner,
        address indexed oldEscrow,
        address indexed newEscrow,
        DataTypes.AuctionInitialization auctionInitialization
    );
    event Withdraw(
        address indexed sender,
        address indexed escrow,
        address to,
        address indexed token,
        uint256 amount
    );
    event BidOnAuction(
        address indexed escrow,
        uint256 relBid,
        address optionReceiver,
        uint256 _refSpot
    );
    event ExerciseCall(
        address indexed escrow,
        address underlyingReceiver,
        uint256 underlyingAmount
    );
    event Borrow(
        address indexed escrow,
        address underlyingReceiver,
        uint256 underlyingAmount
    );
    event Repay(
        address indexed escrow,
        address collateralReceiver,
        uint256 repayUnderlyingAmount
    );
    event TakeQuote(
        address indexed escrowOwner,
        address indexed escrow,
        DataTypes.RFQInitialization rfqInitialization
    );
    event NewFeeHandler(address oldFeeHandler, address newFeeHandler);

    constructor(
        address initOwner,
        address _escrowImpl,
        address _feeHandler
    ) Ownable(initOwner) {
        escrowImpl = _escrowImpl;
        feeHandler = _feeHandler;
    }

    function startAuction(
        address escrowOwner,
        DataTypes.AuctionInitialization calldata auctionInitialization
    ) external {
        address escrow = _createEscrow();
        Escrow(escrow).initializeAuction(
            address(this),
            escrowOwner,
            auctionInitialization
        );
        IERC20Metadata(auctionInitialization.underlyingToken).safeTransferFrom(
            msg.sender,
            escrow,
            auctionInitialization.notional
        );
        emit StartAuction(escrowOwner, escrow, auctionInitialization);
    }

    function withdrawFromEscrowAndStartAuction(
        address oldEscrow,
        address escrowOwner,
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
            escrowOwner,
            auctionInitialization
        );
        IERC20Metadata(auctionInitialization.underlyingToken).safeTransferFrom(
            msg.sender,
            newEscrow,
            auctionInitialization.notional
        );
        emit WithdrawFromEscrowAndStartAuction(
            escrowOwner,
            oldEscrow,
            newEscrow,
            auctionInitialization
        );
    }

    function withdraw(
        address escrow,
        address to,
        address token,
        uint256 amount
    ) external {
        if (!isEscrow[escrow]) {
            revert();
        }
        if (msg.sender != Escrow(escrow).owner()) {
            revert();
        }
        Escrow(escrow).handleWithdraw(to, token, amount);
        emit Withdraw(msg.sender, escrow, to, token, amount);
    }

    function bidOnAuction(
        address escrow,
        address optionReceiver,
        uint256 relBid,
        uint256 _refSpot,
        bytes[] memory _data,
        address distPartner
    )
        external
        returns (
            address settlementToken,
            uint256 _strike,
            uint256 _expiry,
            uint256 _earliestExercise,
            uint256 _premium,
            uint256 _oracleSpotPrice,
            uint256 _protocolFee,
            uint256 _distPartnerFee
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
            _oracleSpotPrice,
            _protocolFee,
            _distPartnerFee
        ) = Escrow(escrow).handleAuctionBid(
            relBid,
            optionReceiver,
            _refSpot,
            _data,
            distPartner
        );
        IERC20Metadata(settlementToken).safeTransferFrom(
            msg.sender,
            Escrow(escrow).owner(),
            _premium - _distPartnerFee - _protocolFee
        );
        if (_distPartnerFee > 0) {
            IERC20Metadata(settlementToken).safeTransferFrom(
                msg.sender,
                distPartner,
                _distPartnerFee
            );
        }
        if (_protocolFee > 0) {
            IERC20Metadata(settlementToken).safeTransferFrom(
                msg.sender,
                address(this),
                _protocolFee
            );
            FeeHandler(feeHandler).collect(settlementToken, _protocolFee);
        }

        emit BidOnAuction(escrow, relBid, optionReceiver, _refSpot);
    }

    function exerciseCall(
        address escrow,
        address underlyingReceiver,
        uint256 underlyingAmount,
        bool settleInUnderlying,
        uint256 refSpot,
        bytes[] memory data
    ) external {
        if (!isEscrow[escrow]) {
            revert();
        }
        (address settlementToken, uint256 settlementAmount) = Escrow(escrow)
            .handleCallExercise(
                msg.sender,
                underlyingReceiver,
                underlyingAmount,
                settleInUnderlying,
                refSpot,
                data
            );
        if (settlementAmount > 0) {
            IERC20Metadata(settlementToken).safeTransferFrom(
                msg.sender,
                Escrow(escrow).owner(),
                settlementAmount
            );
        }
        emit ExerciseCall(escrow, underlyingReceiver, underlyingAmount);
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
        emit Borrow(escrow, underlyingReceiver, borrowUnderlyingAmount);
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
        emit Repay(escrow, collateralReceiver, repayUnderlyingAmount);
    }

    function takeQuote(
        address escrowOwner,
        DataTypes.RFQInitialization calldata rfqInitialization,
        address distPartner
    ) external {
        DataTypes.TakeQuotePreview memory preview = previewTakeQuote(
            rfqInitialization,
            distPartner
        );

        if (preview.status != DataTypes.RFQStatus.Success) {
            revert();
        }

        isQuoteUsed[preview.msgHash] = true;

        address escrow = _createEscrow();
        Escrow(escrow).initializeRFQMatch(
            address(this),
            escrowOwner,
            preview.quoter,
            rfqInitialization
        );

        IERC20Metadata(rfqInitialization.optionInfo.underlyingToken)
            .safeTransferFrom(
                msg.sender,
                escrow,
                rfqInitialization.optionInfo.notional
            );
        IERC20Metadata(rfqInitialization.optionInfo.settlementToken)
            .safeTransferFrom(
                preview.quoter,
                msg.sender,
                rfqInitialization.rfqQuote.premium -
                    preview.distPartnerFee -
                    preview.protocolFee
            );
        if (preview.distPartnerFee > 0) {
            IERC20Metadata(rfqInitialization.optionInfo.settlementToken)
                .safeTransferFrom(
                    msg.sender,
                    distPartner,
                    preview.distPartnerFee
                );
        }
        if (preview.protocolFee > 0) {
            IERC20Metadata(rfqInitialization.optionInfo.settlementToken)
                .safeTransferFrom(
                    msg.sender,
                    address(this),
                    preview.protocolFee
                );
            FeeHandler(feeHandler).collect(
                rfqInitialization.optionInfo.settlementToken,
                preview.protocolFee
            );
        }
        emit TakeQuote(escrowOwner, escrow, rfqInitialization);
    }

    function setFeeHandler(address newFeeHandler) external onlyOwner {
        address oldFeeHandler = feeHandler;
        if (oldFeeHandler == newFeeHandler) {
            revert();
        }
        feeHandler = newFeeHandler;
        emit NewFeeHandler(oldFeeHandler, newFeeHandler);
    }

    function calcFees(
        address premiumToken,
        uint256 premium,
        address distPartner
    ) public view returns (uint256, uint256) {
        (uint256 protocolFee, uint256 distPartnerFee) = FeeHandler(feeHandler)
            .calcFees(premiumToken, premium, distPartner);
        if (
            feeHandler == address(0) ||
            distPartnerFee + protocolFee >= premium ||
            (protocolFee + distPartnerFee) * BASE > premium * MAX_FEE
        ) {
            (protocolFee, distPartnerFee) = (0, 0);
        }
        return (protocolFee, distPartnerFee);
    }

    function previewTakeQuote(
        DataTypes.RFQInitialization calldata rfqInitialization,
        address distPartner
    ) public view returns (DataTypes.TakeQuotePreview memory) {
        bytes32 msgHash = keccak256(
            abi.encode(
                block.chainid,
                rfqInitialization.optionInfo.underlyingToken,
                rfqInitialization.optionInfo.settlementToken,
                rfqInitialization.optionInfo.notional,
                rfqInitialization.optionInfo.strike,
                rfqInitialization.optionInfo.expiry,
                rfqInitialization.optionInfo.earliestExercise,
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
                    quoter: quoter,
                    protocolFee: 0,
                    distPartnerFee: 0
                });
        }

        if (isQuoteUsed[msgHash]) {
            return
                DataTypes.TakeQuotePreview({
                    status: DataTypes.RFQStatus.AlreadyExecuted,
                    msgHash: msgHash,
                    quoter: quoter,
                    protocolFee: 0,
                    distPartnerFee: 0
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
                    quoter: quoter,
                    protocolFee: 0,
                    distPartnerFee: 0
                });
        }
        (uint256 protocolFee, uint256 distPartnerFee) = calcFees(
            rfqInitialization.optionInfo.settlementToken,
            rfqInitialization.rfqQuote.premium,
            distPartner
        );
        return
            DataTypes.TakeQuotePreview({
                status: DataTypes.RFQStatus.Success,
                msgHash: msgHash,
                quoter: quoter,
                protocolFee: protocolFee,
                distPartnerFee: distPartnerFee
            });
    }

    function getEscrows(
        uint256 from,
        uint256 numElements
    ) external view returns (address[] memory _escrows) {
        uint256 length = escrows.length;
        if (numElements == 0 || from + numElements > length) {
            revert();
        }
        _escrows = new address[](numElements);
        for (uint256 i; i < numElements; ) {
            _escrows[i] = escrows[from + i];
            unchecked {
                ++i;
            }
        }
    }

    function _createEscrow() internal returns (address) {
        address escrow = Clones.cloneDeterministic(
            escrowImpl,
            keccak256(abi.encode(numEscrows))
        );
        numEscrows += 1;
        isEscrow[escrow] = true;
        escrows.push(escrow);
        return escrow;
    }
}
