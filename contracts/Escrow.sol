// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {InitializableERC20} from "./utils/InitializableERC20.sol";
import {DataTypes} from "./DataTypes.sol";
import {Router} from "./Router.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {IDelegation} from "./interfaces/IDelegation.sol";

contract Escrow is InitializableERC20 {
    using SafeERC20 for IERC20Metadata;

    uint256 internal constant BASE = 1 ether;

    uint128 public premiumPaid;
    uint128 public totalBorrowed;

    address public router;
    uint96 public exerciseFee;
    address public owner;

    bool public isAuction;
    bool public optionMinted;

    mapping(address => uint256) public borrowedUnderlyingAmounts;

    DataTypes.OptionInfo public optionInfo;
    DataTypes.AuctionParams public auctionParams;

    event OnChainVotingDelegation(address delegate);
    event OffChainVotingDelegation(
        address allowedDelegateRegistry,
        bytes32 spaceId,
        address delegate
    );
    event Withdraw(
        address indexed sender,
        address indexed to,
        address indexed token,
        uint256 amount
    );
    event TransferOwnership(
        address indexed sender,
        address oldOwner,
        address newOwner
    );

    function initializeAuction(
        address _router,
        address _owner,
        uint96 _exerciseFee,
        DataTypes.AuctionInitialization calldata _auctionInitialization
    ) external initializer {
        if (
            _auctionInitialization.underlyingToken ==
            _auctionInitialization.settlementToken
        ) {
            revert();
        }
        if (_auctionInitialization.notional == 0) {
            revert();
        }
        if (_auctionInitialization.auctionParams.relStrike == 0) {
            revert();
        }
        if (_auctionInitialization.auctionParams.tenor == 0) {
            revert();
        }
        if (
            _auctionInitialization.auctionParams.tenor <
            _auctionInitialization.auctionParams.earliestExerciseTenor + 1 days
        ) {
            revert();
        }
        if (
            _auctionInitialization.auctionParams.relPremiumStart == 0 ||
            _auctionInitialization.auctionParams.relPremiumFloor == 0 ||
            _auctionInitialization.auctionParams.relPremiumStart <
            _auctionInitialization.auctionParams.relPremiumFloor
        ) {
            revert();
        }
        if (
            _auctionInitialization.auctionParams.maxSpot == 0 ||
            _auctionInitialization.auctionParams.maxSpot <
            _auctionInitialization.auctionParams.minSpot
        ) {
            revert();
        }
        if (_auctionInitialization.advancedSettings.oracle == address(0)) {
            revert();
        }
        if (_auctionInitialization.advancedSettings.borrowCap > BASE) {
            revert();
        }
        optionInfo.underlyingToken = _auctionInitialization.underlyingToken;
        optionInfo.settlementToken = _auctionInitialization.settlementToken;
        optionInfo.notional = _auctionInitialization.notional;
        optionInfo.advancedSettings = _auctionInitialization.advancedSettings;

        auctionParams = _auctionInitialization.auctionParams;

        isAuction = true;
        _initialize(
            _router,
            _owner,
            _exerciseFee,
            _auctionInitialization.underlyingToken
        );
    }

    function initializeRFQMatch(
        address _router,
        address _owner,
        address optionReceiver,
        uint96 _exerciseFee,
        DataTypes.RFQInitialization calldata _rfqInitialization
    ) external initializer {
        if (
            _rfqInitialization.optionInfo.underlyingToken ==
            _rfqInitialization.optionInfo.settlementToken
        ) {
            revert();
        }
        if (_rfqInitialization.optionInfo.notional == 0) {
            revert();
        }
        if (_rfqInitialization.optionInfo.strike == 0) {
            revert();
        }
        if (
            block.timestamp > _rfqInitialization.optionInfo.expiry ||
            _rfqInitialization.optionInfo.expiry <
            _rfqInitialization.optionInfo.earliestExercise + 1 days
        ) {
            revert();
        }
        if (_rfqInitialization.optionInfo.advancedSettings.borrowCap > BASE) {
            revert();
        }

        optionInfo = _rfqInitialization.optionInfo;
        optionMinted = true;
        premiumPaid = _rfqInitialization.rfqQuote.premium;
        _mint(optionReceiver, _rfqInitialization.optionInfo.notional);

        _initialize(
            _router,
            _owner,
            _exerciseFee,
            _rfqInitialization.optionInfo.underlyingToken
        );
    }

    function handleAuctionBid(
        uint256 relBid,
        address optionReceiver,
        uint256 _refSpot,
        bytes[] memory _oracleData,
        address distPartner
    ) external returns (DataTypes.BidPreview memory preview) {
        if (msg.sender != router) {
            revert();
        }
        preview = previewBid(relBid, _refSpot, _oracleData, distPartner);

        if (preview.status != DataTypes.BidStatus.Success) {
            revert();
        }

        optionInfo.strike = preview.strike;
        optionInfo.expiry = preview.expiry;
        optionInfo.earliestExercise = preview.earliestExercise;

        optionMinted = true;
        premiumPaid = preview.premium;
        _mint(optionReceiver, optionInfo.notional);
    }

    function handleExercise(
        address exerciser,
        address underlyingReceiver,
        uint256 underlyingExerciseAmount,
        bool payInSettlementToken,
        bytes[] memory oracleData
    )
        external
        returns (
            address settlementToken,
            uint256 settlementAmount,
            uint256 exerciseFeeAmount
        )
    {
        if (msg.sender != router) {
            revert();
        }
        if (!optionMinted) {
            revert();
        }
        if (
            block.timestamp > optionInfo.expiry ||
            block.timestamp < optionInfo.earliestExercise
        ) {
            revert();
        }
        if (underlyingExerciseAmount > optionInfo.notional) {
            revert();
        }

        // @dev: caching
        address underlyingToken = optionInfo.underlyingToken;
        uint256 strike = optionInfo.strike;
        uint256 underlyingTokenDecimals = IERC20Metadata(underlyingToken)
            .decimals();

        settlementToken = optionInfo.settlementToken;
        uint256 settlementTokenDecimals = IERC20Metadata(settlementToken)
            .decimals();

        settlementAmount =
            (strike * underlyingExerciseAmount) /
            (10 ** underlyingTokenDecimals);
        exerciseFeeAmount = (settlementAmount * exerciseFee) / BASE;

        uint256 exerciseCostInUnderlying;
        if (!payInSettlementToken) {
            exerciseCostInUnderlying =
                ((strike * underlyingExerciseAmount) *
                    IOracle(optionInfo.advancedSettings.oracle).getPrice(
                        settlementToken,
                        underlyingToken,
                        oracleData
                    )) /
                ((10 ** underlyingTokenDecimals) *
                    (10 ** settlementTokenDecimals));
            if (
                exerciseCostInUnderlying > underlyingExerciseAmount ||
                exerciseCostInUnderlying == 0
            ) {
                // @dev: revert if OTM or exercise cost is null
                revert();
            }
            IERC20Metadata(underlyingToken).safeTransfer(
                owner,
                exerciseCostInUnderlying
            );
        }
        IERC20Metadata(underlyingToken).safeTransfer(
            underlyingReceiver,
            underlyingExerciseAmount - exerciseCostInUnderlying
        );
        _burn(exerciser, underlyingExerciseAmount);
    }

    function handleBorrow(
        address borrower,
        address underlyingReceiver,
        uint128 underlyingBorrowAmount
    )
        external
        returns (
            address settlementToken,
            uint256 collateralAmount,
            uint256 collateralFeeAmount
        )
    {
        if (msg.sender != router) {
            revert();
        }
        if (!optionMinted) {
            revert();
        }
        if (
            block.timestamp > optionInfo.expiry ||
            block.timestamp < optionInfo.earliestExercise
        ) {
            revert();
        }
        if (underlyingBorrowAmount == 0) {
            revert();
        }
        if (
            (totalBorrowed + underlyingBorrowAmount) * BASE >
            optionInfo.notional * optionInfo.advancedSettings.borrowCap
        ) {
            revert();
        }
        settlementToken = optionInfo.settlementToken;
        collateralAmount =
            (optionInfo.strike * underlyingBorrowAmount) /
            optionInfo.notional;
        // @dev: apply exercise fee to ensure equivalence between
        // "borrowing and not repaying" and "regular exercise"
        collateralFeeAmount = (collateralAmount * exerciseFee) / BASE;
        totalBorrowed += underlyingBorrowAmount;
        borrowedUnderlyingAmounts[borrower] += underlyingBorrowAmount;
        _burn(borrower, underlyingBorrowAmount);
        IERC20Metadata(optionInfo.underlyingToken).safeTransfer(
            underlyingReceiver,
            underlyingBorrowAmount
        );
    }

    function handleRepay(
        address borrower,
        address collateralReceiver,
        uint128 underlyingRepayAmount
    )
        external
        returns (address underlyingToken, uint256 unlockedCollateralAmount)
    {
        if (msg.sender != router) {
            revert();
        }
        if (!optionMinted) {
            revert();
        }
        if (
            block.timestamp > optionInfo.expiry ||
            block.timestamp < optionInfo.earliestExercise
        ) {
            revert();
        }
        if (underlyingRepayAmount == 0) {
            revert();
        }
        if (totalBorrowed == 0 || optionInfo.advancedSettings.borrowCap == 0) {
            revert();
        }
        if (underlyingRepayAmount > borrowedUnderlyingAmounts[borrower]) {
            revert();
        }
        underlyingToken = optionInfo.underlyingToken;
        unlockedCollateralAmount =
            (optionInfo.strike * underlyingRepayAmount) /
            optionInfo.notional;
        totalBorrowed -= underlyingRepayAmount;
        borrowedUnderlyingAmounts[borrower] -= underlyingRepayAmount;
        _mint(borrower, underlyingRepayAmount);
        IERC20Metadata(optionInfo.settlementToken).safeTransfer(
            collateralReceiver,
            unlockedCollateralAmount
        );
    }

    function handleOnChainVoting(address delegate) external {
        if (msg.sender != owner) {
            revert();
        }
        if (!optionInfo.advancedSettings.votingDelegationAllowed) {
            revert();
        }
        ERC20Votes(optionInfo.underlyingToken).delegate(delegate);
        emit OnChainVotingDelegation(delegate);
    }

    function handleOffChainVoting(bytes32 spaceId, address delegate) external {
        if (msg.sender != owner) {
            revert();
        }
        address allowedDelegateRegistry = optionInfo
            .advancedSettings
            .allowedDelegateRegistry;
        if (allowedDelegateRegistry != address(0)) {
            revert();
        }
        // @dev: for off-chain voting via Gnosis Delegate Registry
        // see: https://docs.snapshot.org/user-guides/delegation#delegation-contract
        IDelegation(allowedDelegateRegistry).setDelegate(spaceId, delegate);
        emit OffChainVotingDelegation(
            allowedDelegateRegistry,
            spaceId,
            delegate
        );
    }

    function handleWithdraw(
        address to,
        address token,
        uint256 amount
    ) external {
        if (msg.sender != router && msg.sender != owner) {
            revert();
        }
        if (optionMinted && block.timestamp <= optionInfo.expiry) {
            revert();
        }
        IERC20Metadata(token).safeTransfer(to, amount);
        emit Withdraw(msg.sender, to, token, amount);
    }

    function transferOwnership(address newOwner) external {
        address _owner = owner;
        if (msg.sender != _owner) {
            revert();
        }
        if (_owner == newOwner) {
            revert();
        }
        owner = newOwner;
        emit TransferOwnership(msg.sender, _owner, newOwner);
    }

    function previewBid(
        uint256 relBid,
        uint256 _refSpot,
        bytes[] memory _oracleData,
        address distPartner
    ) public view returns (DataTypes.BidPreview memory preview) {
        uint64 _currAsk = currAsk();

        if (!isAuction) {
            return _createBidPreview(DataTypes.BidStatus.NotAnAuction);
        }
        if (optionMinted) {
            return
                _createBidPreview(DataTypes.BidStatus.AuctionAlreadySuccessful);
        }
        if (relBid < _currAsk) {
            return _createBidPreview(DataTypes.BidStatus.PremiumTooLow);
        }
        // @dev: caching
        (address underlyingToken, address settlementToken) = (
            optionInfo.underlyingToken,
            optionInfo.settlementToken
        );

        uint256 oracleSpotPrice = IOracle(optionInfo.advancedSettings.oracle)
            .getPrice(underlyingToken, settlementToken, _oracleData);

        if (_refSpot < oracleSpotPrice) {
            return _createBidPreview(DataTypes.BidStatus.SpotPriceTooLow);
        }

        if (
            oracleSpotPrice < auctionParams.minSpot ||
            oracleSpotPrice > auctionParams.maxSpot
        ) {
            return _createBidPreview(DataTypes.BidStatus.OutOfRangeSpotPrice);
        }

        uint256 notional = optionInfo.notional;
        if (
            IERC20Metadata(underlyingToken).balanceOf(address(this)) < notional
        ) {
            return _createBidPreview(DataTypes.BidStatus.InsufficientFunding);
        }

        bool premiumTokenIsUnderlying = optionInfo
            .advancedSettings
            .premiumTokenIsUnderlying;

        uint128 premium = SafeCast.toUint128(
            premiumTokenIsUnderlying
                ? (_currAsk * notional) / BASE
                : (_currAsk * notional * oracleSpotPrice) /
                    BASE /
                    10 ** IERC20Metadata(underlyingToken).decimals()
        );
        uint128 strikePrice = SafeCast.toUint128(
            (oracleSpotPrice * auctionParams.relStrike) / BASE
        );
        uint48 expiryTime = SafeCast.toUint48(
            block.timestamp + auctionParams.tenor
        );
        uint48 earliestExerciseTime = SafeCast.toUint48(
            block.timestamp + auctionParams.earliestExerciseTenor
        );
        (uint128 matchFeeProtocol, uint128 matchFeeDistPartner) = Router(router)
            .getMatchFees(distPartner, premium);

        if (matchFeeProtocol + matchFeeDistPartner >= premium) {
            return _createBidPreview(DataTypes.BidStatus.InvalidProtocolFees);
        }

        return
            DataTypes.BidPreview({
                status: DataTypes.BidStatus.Success,
                settlementToken: settlementToken,
                underlyingToken: underlyingToken,
                strike: strikePrice,
                expiry: expiryTime,
                earliestExercise: earliestExerciseTime,
                premium: premium,
                premiumToken: premiumTokenIsUnderlying
                    ? underlyingToken
                    : settlementToken,
                oracleSpotPrice: oracleSpotPrice,
                currAsk: _currAsk,
                matchFeeProtocol: matchFeeProtocol,
                matchFeeDistPartner: matchFeeDistPartner
            });
    }

    function currAsk() public view returns (uint64) {
        uint256 _decayStartTime = auctionParams.decayStartTime;
        uint256 _decayDuration = auctionParams.decayDuration;
        uint256 currentAsk;
        if (block.timestamp < _decayStartTime) {
            currentAsk = auctionParams.relPremiumStart;
        } else if (block.timestamp < _decayStartTime + _decayDuration) {
            uint256 _timePassed = block.timestamp - _decayStartTime;
            uint256 _relPremiumFloor = auctionParams.relPremiumFloor;
            uint256 _relPremiumStart = auctionParams.relPremiumStart;
            currentAsk =
                _relPremiumStart -
                ((_relPremiumStart - _relPremiumFloor) * _timePassed) /
                _decayDuration;
        } else {
            currentAsk = auctionParams.relPremiumFloor;
        }
        return SafeCast.toUint64(currentAsk);
    }

    function _initialize(
        address _router,
        address _owner,
        uint96 _exerciseFee,
        address underlyingToken
    ) internal {
        router = _router;
        owner = _owner;
        exerciseFee = _exerciseFee;
        string memory __name = IERC20Metadata(underlyingToken).name();
        string memory __symbol = IERC20Metadata(underlyingToken).symbol();
        _name = string(abi.encodePacked("Call ", __name));
        _symbol = string(abi.encodePacked("Call ", __symbol));
        _decimals = IERC20Metadata(underlyingToken).decimals();
    }

    function _createBidPreview(
        DataTypes.BidStatus status
    ) internal pure returns (DataTypes.BidPreview memory) {
        return
            DataTypes.BidPreview({
                status: status,
                settlementToken: address(0),
                underlyingToken: address(0),
                strike: 0,
                expiry: 0,
                earliestExercise: 0,
                premium: 0,
                premiumToken: address(0),
                oracleSpotPrice: 0,
                currAsk: 0,
                matchFeeProtocol: 0,
                matchFeeDistPartner: 0
            });
    }
}
