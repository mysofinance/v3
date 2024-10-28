// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {InitializableERC20} from "./utils/InitializableERC20.sol";
import {DataTypes} from "./DataTypes.sol";
import {Errors} from "./errors/Errors.sol";
import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";
import {IDelegation} from "./interfaces/IDelegation.sol";
import {IEscrow} from "./interfaces/IEscrow.sol";
import {IRouter} from "./interfaces/IRouter.sol";

contract Escrow is InitializableERC20, IEscrow {
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

    function initializeAuction(
        address _router,
        address _owner,
        uint96 _exerciseFee,
        DataTypes.AuctionInitialization calldata _auctionInitialization,
        uint256 oTokenIndex
    ) external initializer {
        if (
            _auctionInitialization.underlyingToken ==
            _auctionInitialization.settlementToken
        ) {
            revert Errors.InvalidTokenPair();
        }
        if (_auctionInitialization.notional == 0) {
            revert Errors.InvalidNotional();
        }
        if (_auctionInitialization.auctionParams.relStrike == 0) {
            revert Errors.InvalidStrike();
        }
        if (_auctionInitialization.auctionParams.tenor == 0) {
            revert Errors.InvalidTenor();
        }
        if (
            _auctionInitialization.auctionParams.tenor <
            _auctionInitialization.auctionParams.earliestExerciseTenor + 1 days
        ) {
            revert Errors.InvalidEarliestExerciseTenor();
        }
        if (
            _auctionInitialization.auctionParams.relPremiumStart == 0 ||
            _auctionInitialization.auctionParams.relPremiumFloor == 0 ||
            _auctionInitialization.auctionParams.relPremiumStart <
            _auctionInitialization.auctionParams.relPremiumFloor
        ) {
            revert Errors.InvalidRelPremiums();
        }
        if (
            _auctionInitialization.auctionParams.maxSpot == 0 ||
            _auctionInitialization.auctionParams.maxSpot <
            _auctionInitialization.auctionParams.minSpot
        ) {
            revert Errors.InvalidMinMaxSpot();
        }
        if (_auctionInitialization.advancedSettings.oracle == address(0)) {
            revert Errors.InvalidOracle();
        }
        if (_auctionInitialization.advancedSettings.borrowCap > BASE) {
            revert Errors.InvalidBorrowCap();
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
            _auctionInitialization.underlyingToken,
            oTokenIndex
        );
    }

    function initializeRFQMatch(
        address _router,
        address _owner,
        address optionReceiver,
        uint96 _exerciseFee,
        DataTypes.RFQInitialization calldata _rfqInitialization,
        uint256 oTokenIndex
    ) external initializer {
        optionInfo = _rfqInitialization.optionInfo;
        optionMinted = true;
        premiumPaid = _rfqInitialization.rfqQuote.premium;
        _mint(optionReceiver, _rfqInitialization.optionInfo.notional);
        // @dev: automatically set max. allowance to minimize
        // overhead for follow-on option token swapping via router
        _approve(optionReceiver, _router, type(uint256).max);
        _initialize(
            _router,
            _owner,
            _exerciseFee,
            _rfqInitialization.optionInfo.underlyingToken,
            oTokenIndex
        );
    }

    function initializeMintOption(
        address _router,
        address _owner,
        address optionReceiver,
        uint96 _exerciseFee,
        DataTypes.OptionInfo calldata _optionInfo,
        DataTypes.OptionNaming calldata _optionNaming
    ) external initializer {
        optionInfo = _optionInfo;
        optionMinted = true;
        router = _router;
        owner = _owner;
        exerciseFee = _exerciseFee;

        // @dev: initialize with custom name and symbol
        _name = _optionNaming.name;
        _symbol = _optionNaming.symbol;

        _mint(optionReceiver, _optionInfo.notional);

        // @dev: automatically set max. allowance to minimize
        // overhead for follow-on option token swapping via router
        _approve(optionReceiver, _router, type(uint256).max);

        _decimals = IERC20Metadata(_optionInfo.underlyingToken).decimals();
    }

    function handleAuctionBid(
        uint256 relBid,
        address optionReceiver,
        uint256 _refSpot,
        bytes[] memory _oracleData,
        address distPartner
    ) external returns (DataTypes.BidPreview memory preview) {
        address _router = router;
        if (msg.sender != _router) {
            revert Errors.InvalidSender();
        }
        preview = previewBid(relBid, _refSpot, _oracleData, distPartner);

        if (preview.status != DataTypes.BidStatus.Success) {
            revert Errors.InvalidBid();
        }

        optionInfo.strike = preview.strike;
        optionInfo.expiry = preview.expiry;
        optionInfo.earliestExercise = preview.earliestExercise;

        optionMinted = true;
        premiumPaid = preview.premium;
        _mint(optionReceiver, optionInfo.notional);
        // @dev: automatically set max. allowance to minimize
        // overhead for follow-on option token swapping via router
        _approve(optionReceiver, _router, type(uint256).max);
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
            revert Errors.InvalidSender();
        }
        if (!optionMinted) {
            revert Errors.NoOptionMinted();
        }
        if (
            block.timestamp > optionInfo.expiry ||
            block.timestamp < optionInfo.earliestExercise
        ) {
            revert Errors.InvalidExerciseTime();
        }
        if (
            underlyingExerciseAmount == 0 ||
            underlyingExerciseAmount > optionInfo.notional
        ) {
            revert Errors.InvalidExerciseAmount();
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
                    IOracleAdapter(optionInfo.advancedSettings.oracle).getPrice(
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
                revert Errors.InvalidExercise();
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
            revert Errors.InvalidSender();
        }
        if (!optionMinted) {
            revert Errors.NoOptionMinted();
        }
        if (
            block.timestamp > optionInfo.expiry ||
            block.timestamp < optionInfo.earliestExercise
        ) {
            revert Errors.InvalidBorrowTime();
        }
        if (
            underlyingBorrowAmount == 0 ||
            (totalBorrowed + underlyingBorrowAmount) * BASE >
            optionInfo.notional * optionInfo.advancedSettings.borrowCap
        ) {
            revert Errors.InvalidBorrowAmount();
        }
        settlementToken = optionInfo.settlementToken;
        collateralAmount = _getCollateralAmount(
            optionInfo.strike,
            underlyingBorrowAmount,
            optionInfo.notional
        );

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
            revert Errors.InvalidSender();
        }
        if (!optionMinted) {
            revert Errors.NoOptionMinted();
        }
        if (block.timestamp > optionInfo.expiry) {
            revert Errors.InvalidRepayTime();
        }
        if (totalBorrowed == 0) {
            revert Errors.NothingToRepay();
        }
        if (
            underlyingRepayAmount == 0 ||
            underlyingRepayAmount > borrowedUnderlyingAmounts[borrower]
        ) {
            revert Errors.InvalidRepayAmount();
        }
        underlyingToken = optionInfo.underlyingToken;
        unlockedCollateralAmount = _getCollateralAmount(
            optionInfo.strike,
            underlyingRepayAmount,
            optionInfo.notional
        );
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
            revert Errors.InvalidSender();
        }
        if (!optionInfo.advancedSettings.votingDelegationAllowed) {
            revert Errors.VotingDelegationNotAllowed();
        }
        ERC20Votes(optionInfo.underlyingToken).delegate(delegate);
        emit OnChainVotingDelegation(delegate);
    }

    function handleOffChainVoting(bytes32 spaceId, address delegate) external {
        if (msg.sender != owner) {
            revert Errors.InvalidSender();
        }
        address allowedDelegateRegistry = optionInfo
            .advancedSettings
            .allowedDelegateRegistry;
        if (allowedDelegateRegistry == address(0)) {
            revert Errors.NoAllowedDelegateRegistry();
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
            revert Errors.InvalidSender();
        }
        if (optionMinted && block.timestamp <= optionInfo.expiry) {
            revert Errors.InvalidWithdraw();
        }
        IERC20Metadata(token).safeTransfer(to, amount);
        emit Withdraw(msg.sender, to, token, amount);
    }

    function redeem(address to) external {
        address _owner = owner;
        if (msg.sender != _owner) {
            revert Errors.InvalidSender();
        }
        uint256 oustandingOptionTokens = totalSupply();
        if (oustandingOptionTokens == 0) {
            revert Errors.NothingToRedeem();
        }
        if (
            totalBorrowed > 0 || balanceOf(msg.sender) != oustandingOptionTokens
        ) {
            // @dev: cannot redeem in case of outstanding borrows or
            // if escrow owner doesn't hold full option token supply
            revert Errors.InvalidRedeem();
        }
        _burn(msg.sender, oustandingOptionTokens);
        address underlyingToken = optionInfo.underlyingToken;
        uint256 amount = IERC20Metadata(underlyingToken).balanceOf(
            address(this)
        );
        IERC20Metadata(underlyingToken).transfer(to, amount);
        emit Redeem(msg.sender, to, underlyingToken, amount);
    }

    function transferOwnership(address newOwner) external {
        address _owner = owner;
        if (msg.sender != _owner) {
            revert Errors.InvalidSender();
        }
        if (_owner == newOwner) {
            revert Errors.OwnerAlreadySet();
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
        if (optionMinted) {
            return _createBidPreview(DataTypes.BidStatus.OptionAlreadyMinted);
        }
        if (relBid < _currAsk) {
            return _createBidPreview(DataTypes.BidStatus.PremiumTooLow);
        }
        // @dev: caching
        (address underlyingToken, address settlementToken) = (
            optionInfo.underlyingToken,
            optionInfo.settlementToken
        );

        uint256 oracleSpotPrice = IOracleAdapter(
            optionInfo.advancedSettings.oracle
        ).getPrice(underlyingToken, settlementToken, _oracleData);

        if (_refSpot < oracleSpotPrice) {
            return _createBidPreview(DataTypes.BidStatus.SpotPriceTooLow);
        }

        if (
            oracleSpotPrice < auctionParams.minSpot ||
            oracleSpotPrice > auctionParams.maxSpot
        ) {
            return _createBidPreview(DataTypes.BidStatus.OutOfRangeSpotPrice);
        }

        bool premiumTokenIsUnderlying = optionInfo
            .advancedSettings
            .premiumTokenIsUnderlying;
        uint256 notional = optionInfo.notional;
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
        (uint128 matchFeeProtocol, uint128 matchFeeDistPartner) = IRouter(
            router
        ).getMatchFees(distPartner, premium);

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
        address underlyingToken,
        uint256 oTokenIndex
    ) internal {
        router = _router;
        owner = _owner;
        exerciseFee = _exerciseFee;
        string memory __name = IERC20Metadata(underlyingToken).name();
        string memory __symbol = IERC20Metadata(underlyingToken).symbol();
        _name = string(
            abi.encodePacked(__name, " O", Strings.toString(oTokenIndex))
        );
        _symbol = string(
            abi.encodePacked(__symbol, " O", Strings.toString(oTokenIndex))
        );
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

    function _getCollateralAmount(
        uint256 strike,
        uint256 borrowOrRepayAmount,
        uint256 notional
    ) internal pure returns (uint256) {
        return (strike * borrowOrRepayAmount) / notional;
    }
}
