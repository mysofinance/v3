// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {DataTypes} from "./DataTypes.sol";
import {Errors} from "./errors/Errors.sol";
import {IEscrow} from "./interfaces/IEscrow.sol";
import {IFeeHandler} from "./interfaces/IFeeHandler.sol";
import {IRouter} from "./interfaces/IRouter.sol";

contract Router is Ownable, IRouter {
    using SafeERC20 for IERC20Metadata;

    uint64 internal constant BASE = 1 ether;
    uint96 internal constant MAX_MATCH_FEE = 0.2 ether;
    uint96 internal constant MAX_EXERCISE_FEE = 0.005 ether;

    // @dev: EIP-1271 with bytes4(keccak256("isValidSignature(bytes32,bytes)")
    bytes4 internal constant EIP1271_SIG_AND_MAGIC_VALUE = 0x1626ba7e;

    address public immutable escrowImpl;
    address public feeHandler;
    uint256 public numEscrows;

    mapping(address => bool) public isEscrow;
    mapping(bytes32 => bool) public isQuoteUsed;
    mapping(bytes32 => bool) public isSwapQuoteUsed;
    mapping(address => bool) public quotesPaused;

    address[] internal _escrows;

    constructor(address initOwner, address _escrowImpl) Ownable(initOwner) {
        if (_escrowImpl == address(0)) {
            revert Errors.InvalidAddress();
        }
        escrowImpl = _escrowImpl;
    }

    function createAuction(
        address escrowOwner,
        DataTypes.AuctionInitialization calldata auctionInitialization,
        address distPartner
    ) external {
        (address escrow, uint256 oTokenIndex) = _createEscrow();
        uint96 exerciseFee = getExerciseFee();
        IEscrow(escrow).initializeAuction(
            address(this),
            escrowOwner,
            exerciseFee,
            auctionInitialization,
            oTokenIndex,
            distPartner
        );
        IERC20Metadata(auctionInitialization.underlyingToken).safeTransferFrom(
            msg.sender,
            escrow,
            auctionInitialization.notional
        );
        emit CreateAuction(
            escrowOwner,
            escrow,
            auctionInitialization,
            exerciseFee,
            distPartner
        );
    }

    function withdrawFromEscrowAndCreateAuction(
        address oldEscrow,
        address escrowOwner,
        DataTypes.AuctionInitialization calldata auctionInitialization,
        address distPartner
    ) external {
        if (!isEscrow[oldEscrow]) {
            revert Errors.NotAnEscrow();
        }
        if (msg.sender != IEscrow(oldEscrow).owner()) {
            revert Errors.InvalidSender();
        }
        (address newEscrow, uint256 oTokenIndex) = _createEscrow();
        IEscrow(newEscrow).initializeAuction(
            address(this),
            escrowOwner,
            getExerciseFee(),
            auctionInitialization,
            oTokenIndex,
            distPartner
        );

        uint256 oldEscrowBal = IERC20Metadata(
            auctionInitialization.underlyingToken
        ).balanceOf(oldEscrow);

        // @dev: if new notional gte old escrow balance
        // then we can rollover funds
        address withdrawTo = auctionInitialization.notional >= oldEscrowBal
            ? newEscrow
            : msg.sender;
        uint256 netTransferAmountNeeded = auctionInitialization.notional >=
            oldEscrowBal
            ? auctionInitialization.notional - oldEscrowBal
            : auctionInitialization.notional;

        IEscrow(oldEscrow).handleWithdraw(
            withdrawTo,
            auctionInitialization.underlyingToken,
            oldEscrowBal
        );

        // @dev: iff new notional equal old escrow balance
        // then no transfer needed
        if (netTransferAmountNeeded > 0) {
            IERC20Metadata(auctionInitialization.underlyingToken)
                .safeTransferFrom(
                    msg.sender,
                    newEscrow,
                    netTransferAmountNeeded
                );
        }

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
        if (msg.sender != IEscrow(escrow).owner()) {
            revert Errors.InvalidSender();
        }
        IEscrow(escrow).handleWithdraw(to, token, amount);
        emit Withdraw(msg.sender, escrow, to, token, amount);
    }

    function bidOnAuction(
        address escrow,
        address optionReceiver,
        uint256 relBid,
        uint256 _refSpot,
        bytes[] memory _oracleData
    )
        external
        returns (DataTypes.BidPreview memory preview, address distPartner)
    {
        if (!isEscrow[escrow]) {
            revert Errors.NotAnEscrow();
        }
        (preview, distPartner) = IEscrow(escrow).handleAuctionBid(
            relBid,
            optionReceiver,
            _refSpot,
            _oracleData
        );
        IERC20Metadata(preview.premiumToken).safeTransferFrom(
            msg.sender,
            IEscrow(escrow).owner(),
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
            address _feeHandler = feeHandler;
            IERC20Metadata(preview.premiumToken).safeTransferFrom(
                msg.sender,
                _feeHandler,
                preview.matchFeeProtocol
            );
            IFeeHandler(_feeHandler).provisionFees(
                preview.premiumToken,
                preview.matchFeeProtocol
            );
        }

        emit BidOnAuction(
            msg.sender,
            escrow,
            optionReceiver,
            preview,
            distPartner
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
        ) = IEscrow(escrow).handleExercise(
                msg.sender,
                underlyingReceiver,
                underlyingAmount,
                payInSettlementToken,
                oracleData
            );
        if (payInSettlementToken) {
            IERC20Metadata(settlementToken).safeTransferFrom(
                msg.sender,
                IEscrow(escrow).owner(),
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
            IFeeHandler(_feeHandler).provisionFees(
                settlementToken,
                exerciseFeeAmount
            );
        }
        emit Exercise(
            msg.sender,
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
        ) = IEscrow(escrow).handleBorrow(
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
            IFeeHandler(_feeHandler).provisionFees(
                settlementToken,
                collateralFeeAmount
            );
        }
        emit Borrow(
            msg.sender,
            escrow,
            underlyingReceiver,
            borrowUnderlyingAmount,
            collateralAmount,
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
        (address underlyingToken, uint256 unlockedCollateralAmount) = IEscrow(
            escrow
        ).handleRepay(msg.sender, collateralReceiver, repayUnderlyingAmount);
        IERC20Metadata(underlyingToken).safeTransferFrom(
            msg.sender,
            escrow,
            repayUnderlyingAmount
        );
        emit Repay(
            escrow,
            escrow,
            collateralReceiver,
            repayUnderlyingAmount,
            unlockedCollateralAmount
        );
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
        uint96 exerciseFee = getExerciseFee();
        IEscrow(escrow).initializeRFQMatch(
            address(this),
            escrowOwner,
            preview.quoter,
            exerciseFee,
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
            address _feeHandler = feeHandler;
            IERC20Metadata(preview.premiumToken).safeTransferFrom(
                preview.quoter,
                _feeHandler,
                preview.matchFeeProtocol
            );
            IFeeHandler(_feeHandler).provisionFees(
                preview.premiumToken,
                preview.matchFeeProtocol
            );
        }
        emit TakeQuote(
            msg.sender,
            escrowOwner,
            escrow,
            rfqInitialization,
            preview,
            exerciseFee,
            distPartner
        );
    }

    function takeSwapQuote(
        address to,
        DataTypes.SwapQuote calldata swapQuote
    ) external {
        if (block.timestamp > swapQuote.validUntil) {
            revert Errors.SwapQuoteExpired();
        }

        bytes32 msgHash = keccak256(
            abi.encode(
                block.chainid,
                swapQuote.takerGiveToken,
                swapQuote.takerGiveAmount,
                swapQuote.makerGiveToken,
                swapQuote.makerGiveAmount,
                swapQuote.validUntil
            )
        );

        address maker;
        if (swapQuote.eip1271Maker == address(0)) {
            maker = ECDSA.recover(
                MessageHashUtils.toEthSignedMessageHash(msgHash),
                swapQuote.signature
            );
        } else {
            bool isValid = _checkEIP1271Signature(
                swapQuote.eip1271Maker,
                msgHash,
                swapQuote.signature
            );
            if (!isValid) {
                revert Errors.InvalidEIP1271Signature();
            }
            maker = swapQuote.eip1271Maker;
        }

        if (quotesPaused[maker]) {
            revert Errors.SwapQuotePaused();
        }
        if (isSwapQuoteUsed[msgHash]) {
            revert Errors.SwapQuoteAlreadyUsed();
        }
        isSwapQuoteUsed[msgHash] = true;
        IERC20Metadata(swapQuote.takerGiveToken).safeTransferFrom(
            msg.sender,
            maker,
            swapQuote.takerGiveAmount
        );
        IERC20Metadata(swapQuote.makerGiveToken).safeTransferFrom(
            maker,
            to,
            swapQuote.makerGiveAmount
        );
        emit TakeSwapQuote(msg.sender, to, maker, swapQuote);
    }

    function togglePauseQuotes() external {
        bool isPaused = quotesPaused[msg.sender];
        quotesPaused[msg.sender] = !isPaused;
        emit PauseQuotes(msg.sender, !isPaused);
    }

    function mintOption(
        address optionReceiver,
        address escrowOwner,
        DataTypes.OptionInfo calldata optionInfo,
        DataTypes.OptionNaming calldata optionNaming,
        address distPartner
    ) external {
        if (optionInfo.underlyingToken == optionInfo.settlementToken) {
            revert Errors.InvalidTokenPair();
        }
        if (optionInfo.notional == 0) {
            revert Errors.InvalidNotional();
        }
        if (block.timestamp > optionInfo.expiry) {
            revert Errors.InvalidExpiry();
        }
        if (optionInfo.expiry < optionInfo.earliestExercise + 1 days) {
            revert Errors.InvalidEarliestExercise();
        }
        if (optionInfo.advancedSettings.borrowCap > BASE) {
            revert Errors.InvalidBorrowCap();
        }
        (address escrow, ) = _createEscrow();
        (uint256 mintFeeProtocol, uint256 mintFeeDistPartner) = getMintFees(
            distPartner,
            optionInfo.notional
        );
        address mintOptionTokensTo = (mintFeeProtocol > 0 ||
            mintFeeDistPartner > 0)
            ? address(this)
            : optionReceiver;
        IEscrow(escrow).initializeMintOption(
            address(this),
            escrowOwner,
            mintOptionTokensTo,
            getExerciseFee(),
            optionInfo,
            optionNaming
        );
        IERC20Metadata(optionInfo.underlyingToken).safeTransferFrom(
            msg.sender,
            escrow,
            optionInfo.notional
        );
        if (mintOptionTokensTo == address(this)) {
            IERC20Metadata(escrow).safeTransfer(
                optionReceiver,
                optionInfo.notional - mintFeeProtocol - mintFeeDistPartner
            );
            if (mintFeeDistPartner > 0) {
                IERC20Metadata(escrow).safeTransfer(
                    distPartner,
                    mintFeeDistPartner
                );
            }
            if (mintFeeProtocol > 0) {
                IERC20Metadata(escrow).safeTransfer(
                    feeHandler,
                    mintFeeProtocol
                );
                IFeeHandler(feeHandler).provisionFees(escrow, mintFeeProtocol);
            }
        }
        emit MintOption(
            msg.sender,
            optionReceiver,
            escrowOwner,
            optionInfo,
            mintFeeProtocol,
            mintFeeDistPartner,
            distPartner
        );
    }

    function setFeeHandler(address newFeeHandler) external onlyOwner {
        address oldFeeHandler = feeHandler;
        if (oldFeeHandler == newFeeHandler) {
            revert Errors.FeeHandlerAlreadySet();
        }
        feeHandler = newFeeHandler;
        emit NewFeeHandler(oldFeeHandler, newFeeHandler);
    }

    function emitTransferEvent(
        address from,
        address to,
        uint256 value
    ) external {
        address escrow = msg.sender;
        if (!isEscrow[escrow]) {
            revert Errors.NotAnEscrow();
        }
        emit Transfer(escrow, from, to, value);
    }

    function emitTransferOwnershipEvent(
        address oldOwner,
        address newOwner
    ) external {
        address escrow = msg.sender;
        if (!isEscrow[escrow]) {
            revert Errors.NotAnEscrow();
        }
        emit TransferOwnership(escrow, oldOwner, newOwner);
    }

    function getExerciseFee() public view returns (uint96 exerciseFee) {
        address _feeHandler = feeHandler;
        if (_feeHandler == address(0)) {
            return 0;
        }
        exerciseFee = IFeeHandler(_feeHandler).exerciseFee();
        exerciseFee = exerciseFee > MAX_EXERCISE_FEE
            ? MAX_EXERCISE_FEE
            : exerciseFee;
    }

    function getMatchFees(
        address distPartner,
        uint128 optionPremium,
        DataTypes.OptionInfo calldata optionInfo
    )
        public
        view
        returns (uint128 matchFeeProtocol, uint128 matchFeeDistPartner)
    {
        address _feeHandler = feeHandler;
        if (_feeHandler != address(0)) {
            (uint256 matchFee, uint256 matchFeeDistPartnerShare) = IFeeHandler(
                _feeHandler
            ).getMatchFeeInfo(distPartner, optionPremium, optionInfo);

            uint256 cappedMatchFee = matchFee > MAX_MATCH_FEE
                ? MAX_MATCH_FEE
                : matchFee;
            uint256 cappedMatchFeeDistPartnerShare = matchFeeDistPartnerShare >
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

    function getMintFees(
        address distPartner,
        uint128 notional
    )
        public
        view
        returns (uint256 mintFeeProtocol, uint256 mintFeeDistPartner)
    {
        address _feeHandler = feeHandler;
        if (_feeHandler != address(0)) {
            (uint256 mintFee, uint256 mintFeeDistPartnerShare) = IFeeHandler(
                _feeHandler
            ).getMintFeeInfo(distPartner);

            // @dev: use same cap as for match fee
            uint256 cappedMintFee = mintFee > MAX_MATCH_FEE
                ? MAX_MATCH_FEE
                : mintFee;
            uint256 cappedMintFeeDistPartnerShare = mintFeeDistPartnerShare >
                BASE
                ? BASE
                : mintFeeDistPartnerShare;
            uint256 totalMintFee = (notional * cappedMintFee) / BASE;
            mintFeeDistPartner =
                (totalMintFee * cappedMintFeeDistPartnerShare) /
                BASE;
            mintFeeProtocol = totalMintFee - mintFeeDistPartner;
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

        address quoter;
        if (rfqInitialization.rfqQuote.eip1271Maker == address(0)) {
            quoter = ECDSA.recover(
                MessageHashUtils.toEthSignedMessageHash(msgHash),
                rfqInitialization.rfqQuote.signature
            );
        } else {
            bool isValid = _checkEIP1271Signature(
                rfqInitialization.rfqQuote.eip1271Maker,
                msgHash,
                rfqInitialization.rfqQuote.signature
            );
            if (!isValid) {
                return
                    _createTakeQuotePreview(
                        DataTypes.RFQStatus.InvalidEIP1271Signature,
                        msgHash,
                        quoter
                    );
            }
            quoter = rfqInitialization.rfqQuote.eip1271Maker;
        }

        if (
            rfqInitialization.optionInfo.underlyingToken ==
            rfqInitialization.optionInfo.settlementToken ||
            rfqInitialization.optionInfo.notional == 0 ||
            rfqInitialization.optionInfo.strike == 0 ||
            rfqInitialization.optionInfo.expiry <
            rfqInitialization.optionInfo.earliestExercise + 1 days ||
            rfqInitialization.optionInfo.advancedSettings.borrowCap > BASE
        ) {
            return
                _createTakeQuotePreview(
                    DataTypes.RFQStatus.InvalidQuote,
                    msgHash,
                    quoter
                );
        }

        if (
            block.timestamp > rfqInitialization.rfqQuote.validUntil ||
            block.timestamp > rfqInitialization.optionInfo.expiry
        ) {
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
        (uint128 matchFeeProtocol, uint128 matchFeeDistPartner) = getMatchFees(
            distPartner,
            rfqInitialization.rfqQuote.premium,
            rfqInitialization.optionInfo
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

    function getEscrows(
        uint256 from,
        uint256 numElements
    ) external view returns (address[] memory _escrowArray) {
        uint256 length = _escrows.length;
        if (numElements == 0 || from + numElements > length) {
            revert Errors.InvalidGetEscrowsQuery();
        }
        _escrowArray = new address[](numElements);
        for (uint256 i = 0; i < numElements; ++i) {
            _escrowArray[i] = _escrows[from + i];
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
        _escrows.push(escrow);
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

    function _checkEIP1271Signature(
        address erc1271Wallet,
        bytes32 msgHash,
        bytes calldata signature
    ) internal view returns (bool isValid) {
        // @dev: legacy EIP1271 wallets using bytes4(keccak256("isValidSignature(bytes,bytes)")
        // are not supported
        (bool success, bytes memory returnData) = erc1271Wallet.staticcall(
            abi.encodeWithSelector(
                EIP1271_SIG_AND_MAGIC_VALUE,
                msgHash,
                signature
            )
        );
        if (success && returnData.length == 32) {
            bytes4 result = abi.decode(returnData, (bytes4));
            return result == EIP1271_SIG_AND_MAGIC_VALUE;
        }
        return false;
    }
}
