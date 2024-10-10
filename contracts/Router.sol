// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Escrow} from "./Escrow.sol";
import {FeeHandler} from "./feehandler/FeeHandler.sol";
import {DataTypes} from "./DataTypes.sol";
import {Errors} from "./errors/Errors.sol";

contract Router is Ownable {
    using SafeERC20 for IERC20Metadata;

    uint64 internal constant BASE = 1 ether;
    uint96 internal constant MAX_MATCH_FEE = 0.2 ether;
    uint96 internal constant MAX_EXERCISE_FEE = 0.005 ether;

    address public immutable escrowImpl;
    address public feeHandler;
    uint256 public numEscrows;

    mapping(address => bool) public isEscrow;
    mapping(bytes32 => bool) public isQuoteUsed;
    mapping(address => bool) public quotesPaused;
    address[] public escrows;

    event CreateAuction(
        address indexed escrowOwner,
        address indexed escrow,
        DataTypes.AuctionInitialization auctionInitialization
    );
    event WithdrawFromEscrowAndCreateAuction(
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
        uint256 refSpot,
        uint256 matchFeeProtocol,
        uint256 matchFeeDistPartner
    );
    event Exercise(
        address indexed escrow,
        address underlyingReceiver,
        uint256 underlyingAmount,
        uint256 exerciseFeeAmount
    );
    event Borrow(
        address indexed escrow,
        address underlyingReceiver,
        uint128 underlyingAmount,
        uint256 collateralFeeAmount
    );
    event Repay(
        address indexed escrow,
        address collateralReceiver,
        uint128 repayUnderlyingAmount
    );
    event TakeQuote(
        address indexed escrowOwner,
        address indexed escrow,
        DataTypes.RFQInitialization rfqInitialization,
        uint256 matchFeeProtocol,
        uint256 matchFeeDistPartner
    );
    event NewFeeHandler(address oldFeeHandler, address newFeeHandler);
    event PauseQuotes(address indexed quoter, bool isPaused);

    constructor(address initOwner, address _escrowImpl) Ownable(initOwner) {
        escrowImpl = _escrowImpl;
    }

    function createAuction(
        address escrowOwner,
        DataTypes.AuctionInitialization calldata auctionInitialization
    ) external {
        (address escrow, uint256 oTokenIndex) = _createEscrow();
        Escrow(escrow).initializeAuction(
            address(this),
            escrowOwner,
            getExerciseFee(),
            auctionInitialization,
            oTokenIndex
        );
        IERC20Metadata(auctionInitialization.underlyingToken).safeTransferFrom(
            msg.sender,
            escrow,
            auctionInitialization.notional
        );
        emit CreateAuction(escrowOwner, escrow, auctionInitialization);
    }

    function withdrawFromEscrowAndCreateAuction(
        address oldEscrow,
        address escrowOwner,
        DataTypes.AuctionInitialization calldata auctionInitialization
    ) external {
        if (!isEscrow[oldEscrow]) {
            revert Errors.NotAnEscrow();
        }
        if (msg.sender != Escrow(oldEscrow).owner()) {
            revert Errors.InvalidSender();
        }
        Escrow(oldEscrow).handleWithdraw(
            msg.sender,
            auctionInitialization.underlyingToken,
            IERC20Metadata(auctionInitialization.underlyingToken).balanceOf(
                oldEscrow
            )
        );
        (address newEscrow, uint256 oTokenIndex) = _createEscrow();
        Escrow(newEscrow).initializeAuction(
            address(this),
            escrowOwner,
            getExerciseFee(),
            auctionInitialization,
            oTokenIndex
        );
        IERC20Metadata(auctionInitialization.underlyingToken).safeTransferFrom(
            msg.sender,
            newEscrow,
            auctionInitialization.notional
        );
        emit WithdrawFromEscrowAndCreateAuction(
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
            revert Errors.NotAnEscrow();
        }
        if (msg.sender != Escrow(escrow).owner()) {
            revert Errors.InvalidSender();
        }
        Escrow(escrow).handleWithdraw(to, token, amount);
        emit Withdraw(msg.sender, escrow, to, token, amount);
    }

    function bidOnAuction(
        address escrow,
        address optionReceiver,
        uint256 relBid,
        uint256 _refSpot,
        bytes[] memory _oracleData,
        address distPartner
    ) external returns (DataTypes.BidPreview memory preview) {
        if (!isEscrow[escrow]) {
            revert Errors.NotAnEscrow();
        }
        preview = Escrow(escrow).handleAuctionBid(
            relBid,
            optionReceiver,
            _refSpot,
            _oracleData,
            distPartner
        );
        IERC20Metadata(preview.premiumToken).safeTransferFrom(
            msg.sender,
            Escrow(escrow).owner(),
            preview.premium -
                preview.matchFeeDistPartner -
                preview.matchFeeProtocol
        );
        if (preview.matchFeeDistPartner > 0) {
            IERC20Metadata(preview.premiumToken).safeTransferFrom(
                msg.sender,
                distPartner,
                preview.matchFeeDistPartner
            );
        }
        if (preview.matchFeeProtocol > 0) {
            IERC20Metadata(preview.premiumToken).safeTransferFrom(
                msg.sender,
                feeHandler,
                preview.matchFeeProtocol
            );
            FeeHandler(feeHandler).provisionFees(
                preview.premiumToken,
                preview.matchFeeProtocol
            );
        }

        emit BidOnAuction(
            escrow,
            relBid,
            optionReceiver,
            _refSpot,
            preview.matchFeeProtocol,
            preview.matchFeeDistPartner
        );
    }

    function exercise(
        address escrow,
        address underlyingReceiver,
        uint256 underlyingAmount,
        bool payInSettlementToken,
        bytes[] memory oracleData
    ) external {
        if (!isEscrow[escrow]) {
            revert Errors.NotAnEscrow();
        }
        (
            address settlementToken,
            uint256 settlementAmount,
            uint256 exerciseFeeAmount
        ) = Escrow(escrow).handleExercise(
                msg.sender,
                underlyingReceiver,
                underlyingAmount,
                payInSettlementToken,
                oracleData
            );
        if (payInSettlementToken) {
            IERC20Metadata(settlementToken).safeTransferFrom(
                msg.sender,
                Escrow(escrow).owner(),
                settlementAmount
            );
        }
        address _feeHandler = feeHandler;
        if (_feeHandler != address(0) && exerciseFeeAmount > 0) {
            IERC20Metadata(settlementToken).safeTransferFrom(
                msg.sender,
                feeHandler,
                exerciseFeeAmount
            );
            FeeHandler(_feeHandler).provisionFees(
                settlementToken,
                exerciseFeeAmount
            );
        }
        emit Exercise(
            escrow,
            underlyingReceiver,
            underlyingAmount,
            exerciseFeeAmount
        );
    }

    function borrow(
        address escrow,
        address underlyingReceiver,
        uint128 borrowUnderlyingAmount
    ) external {
        if (!isEscrow[escrow]) {
            revert Errors.NotAnEscrow();
        }
        (
            address settlementToken,
            uint256 collateralAmount,
            uint256 collateralFeeAmount
        ) = Escrow(escrow).handleBorrow(
                msg.sender,
                underlyingReceiver,
                borrowUnderlyingAmount
            );
        IERC20Metadata(settlementToken).safeTransferFrom(
            msg.sender,
            escrow,
            collateralAmount
        );
        address _feeHandler = feeHandler;
        if (_feeHandler != address(0) && collateralFeeAmount > 0) {
            IERC20Metadata(settlementToken).safeTransferFrom(
                msg.sender,
                feeHandler,
                collateralFeeAmount
            );
            FeeHandler(_feeHandler).provisionFees(
                settlementToken,
                collateralFeeAmount
            );
        }
        emit Borrow(
            escrow,
            underlyingReceiver,
            borrowUnderlyingAmount,
            collateralFeeAmount
        );
    }

    function repay(
        address escrow,
        address collateralReceiver,
        uint128 repayUnderlyingAmount
    ) external {
        if (!isEscrow[escrow]) {
            revert Errors.NotAnEscrow();
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
            revert Errors.InvalidTakeQuote();
        }

        isQuoteUsed[preview.msgHash] = true;

        (address escrow, uint256 oTokenIndex) = _createEscrow();
        Escrow(escrow).initializeRFQMatch(
            address(this),
            escrowOwner,
            preview.quoter,
            getExerciseFee(),
            rfqInitialization,
            oTokenIndex
        );

        IERC20Metadata(rfqInitialization.optionInfo.underlyingToken)
            .safeTransferFrom(
                msg.sender,
                escrow,
                rfqInitialization.optionInfo.notional
            );
        IERC20Metadata(preview.premiumToken).safeTransferFrom(
            preview.quoter,
            msg.sender,
            rfqInitialization.rfqQuote.premium -
                preview.matchFeeDistPartner -
                preview.matchFeeProtocol
        );
        if (preview.matchFeeDistPartner > 0) {
            IERC20Metadata(preview.premiumToken).safeTransferFrom(
                preview.quoter,
                distPartner,
                preview.matchFeeDistPartner
            );
        }
        if (preview.matchFeeProtocol > 0) {
            IERC20Metadata(preview.premiumToken).safeTransferFrom(
                preview.quoter,
                feeHandler,
                preview.matchFeeProtocol
            );
            FeeHandler(feeHandler).provisionFees(
                preview.premiumToken,
                preview.matchFeeProtocol
            );
        }
        emit TakeQuote(
            escrowOwner,
            escrow,
            rfqInitialization,
            preview.matchFeeProtocol,
            preview.matchFeeDistPartner
        );
    }

    function takeSwapQuote(DataTypes.SwapQuote calldata swapQuote) external {
        DataTypes.TakeSwapQuotePreview memory preview = previewTakeSwapQuote(
            swapQuote
        );

        if (preview.status != DataTypes.RFQStatus.Success) {
            revert Errors.InvalidTakeQuote();
        }

        // @dev: placeholder
    }

    function togglePauseQuotes() external {
        bool isPaused = quotesPaused[msg.sender];
        quotesPaused[msg.sender] = !isPaused;
        emit PauseQuotes(msg.sender, !isPaused);
    }

    function setFeeHandler(address newFeeHandler) external onlyOwner {
        address oldFeeHandler = feeHandler;
        if (oldFeeHandler == newFeeHandler) {
            revert Errors.FeeHandlerAlreadySet();
        }
        feeHandler = newFeeHandler;
        emit NewFeeHandler(oldFeeHandler, newFeeHandler);
    }

    function getExerciseFee() public view returns (uint96 exerciseFee) {
        if (feeHandler == address(0)) {
            return 0;
        }
        exerciseFee = FeeHandler(feeHandler).exerciseFee();
        exerciseFee = exerciseFee > MAX_EXERCISE_FEE
            ? MAX_EXERCISE_FEE
            : exerciseFee;
    }

    function getMatchFees(
        address distPartner,
        uint128 optionPremium
    )
        public
        view
        returns (uint128 matchFeeProtocol, uint128 matchFeeDistPartner)
    {
        if (feeHandler != address(0)) {
            (uint96 matchFee, uint96 matchFeeDistPartnerShare) = FeeHandler(
                feeHandler
            ).getMatchFeeInfo(distPartner);

            uint96 cappedMatchFee = matchFee > MAX_MATCH_FEE
                ? MAX_MATCH_FEE
                : matchFee;
            uint96 cappedMatchFeeDistPartnerShare = matchFeeDistPartnerShare >
                BASE
                ? BASE
                : matchFeeDistPartnerShare;
            uint256 totalMatchFee = (optionPremium * cappedMatchFee) / BASE;
            matchFeeDistPartner = SafeCast.toUint128(
                (totalMatchFee * cappedMatchFeeDistPartnerShare) / BASE
            );
            matchFeeProtocol = SafeCast.toUint128(
                totalMatchFee - matchFeeDistPartner
            );
        }
    }

    function previewTakeQuote(
        DataTypes.RFQInitialization calldata rfqInitialization,
        address distPartner
    ) public view returns (DataTypes.TakeQuotePreview memory) {
        bytes32 msgHash = keccak256(
            abi.encode(
                block.chainid,
                rfqInitialization.optionInfo,
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
                _createTakeQuotePreview(
                    DataTypes.RFQStatus.Expired,
                    msgHash,
                    quoter
                );
        }

        if (isQuoteUsed[msgHash]) {
            return
                _createTakeQuotePreview(
                    DataTypes.RFQStatus.AlreadyExecuted,
                    msgHash,
                    quoter
                );
        }

        if (quotesPaused[quoter]) {
            return
                _createTakeQuotePreview(
                    DataTypes.RFQStatus.QuotesPaused,
                    msgHash,
                    quoter
                );
        }

        uint256 balance = IERC20Metadata(
            rfqInitialization.optionInfo.settlementToken
        ).balanceOf(quoter);

        if (balance < rfqInitialization.rfqQuote.premium) {
            return
                _createTakeQuotePreview(
                    DataTypes.RFQStatus.InsufficientFunding,
                    msgHash,
                    quoter
                );
        }
        (uint128 matchFeeProtocol, uint128 matchFeeDistPartner) = getMatchFees(
            distPartner,
            rfqInitialization.rfqQuote.premium
        );
        return
            DataTypes.TakeQuotePreview({
                status: DataTypes.RFQStatus.Success,
                msgHash: msgHash,
                quoter: quoter,
                premium: rfqInitialization.rfqQuote.premium,
                premiumToken: rfqInitialization
                    .optionInfo
                    .advancedSettings
                    .premiumTokenIsUnderlying
                    ? rfqInitialization.optionInfo.underlyingToken
                    : rfqInitialization.optionInfo.settlementToken,
                matchFeeProtocol: matchFeeProtocol,
                matchFeeDistPartner: matchFeeDistPartner
            });
    }

    function previewTakeSwapQuote(
        DataTypes.SwapQuote calldata swapQuote
    ) public view returns (DataTypes.TakeSwapQuotePreview memory) {}

    function getEscrows(
        uint256 from,
        uint256 numElements
    ) external view returns (address[] memory _escrows) {
        uint256 length = escrows.length;
        if (numElements == 0 || from + numElements > length) {
            revert Errors.InvalidGetEscrowsQuery();
        }
        _escrows = new address[](numElements);
        for (uint256 i = 0; i < numElements; ++i) {
            _escrows[i] = escrows[from + i];
        }
    }

    function _createEscrow()
        internal
        returns (address escrow, uint256 oTokenIndex)
    {
        oTokenIndex = numEscrows + 1;
        escrow = Clones.cloneDeterministic(
            escrowImpl,
            keccak256(abi.encode(oTokenIndex))
        );
        numEscrows = oTokenIndex;
        isEscrow[escrow] = true;
        escrows.push(escrow);
    }

    function _createTakeQuotePreview(
        DataTypes.RFQStatus status,
        bytes32 msgHash,
        address quoter
    ) internal pure returns (DataTypes.TakeQuotePreview memory) {
        return
            DataTypes.TakeQuotePreview({
                status: status,
                msgHash: msgHash,
                quoter: quoter,
                premium: 0,
                premiumToken: address(0),
                matchFeeProtocol: 0,
                matchFeeDistPartner: 0
            });
    }
}
