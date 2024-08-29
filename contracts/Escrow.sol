// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {InitializableERC20} from "./utils/InitializableERC20.sol";
import {DataTypes} from "./DataTypes.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {IDelegation} from "./interfaces/IDelegation.sol";

contract Escrow is InitializableERC20 {
    using SafeERC20 for IERC20Metadata;

    uint256 internal constant BASE = 1 ether;

    address public router;
    address public owner;
    uint256 public strike;
    uint256 public expiry;
    uint256 public earliestExercise;
    bool internal _initialized;

    DataTypes.AuctionInfo public auctionInfo;
    mapping(address => uint256) public borrowedUnderlyingAmounts;

    event OptionExercised(address indexed exerciser);
    event Withdrawn(address indexed to, address indexed token, uint256 amount);

    function initialize(address _router, address _owner) external initializer {
        router = _router;
        owner = _owner;
    }

    function initializeAuction(
        DataTypes.AuctionInfo calldata _auctionInfo
    ) external {
        if (_initialized) {
            revert();
        }
        if (
            _auctionInfo.pricingInfo.notional == 0 ||
            _auctionInfo.pricingInfo.tenor == 0
        ) {
            revert();
        }
        _initialized = true;
        auctionInfo = _auctionInfo;
        string memory __name = IERC20Metadata(
            _auctionInfo.tokenInfo.underlyingToken
        ).name();
        string memory __symbol = IERC20Metadata(
            _auctionInfo.tokenInfo.underlyingToken
        ).symbol();
        _name = string(abi.encodePacked("Call ", __name));
        _symbol = string(abi.encodePacked("Call ", __symbol));
        _decimals = IERC20Metadata(_auctionInfo.tokenInfo.underlyingToken)
            .decimals();
    }

    function initializeRFQMatch(
        address optionReceiver,
        DataTypes.Quote calldata quote
    ) external {
        if (_initialized) {
            revert();
        }
        _initialized = true;
        auctionInfo.tokenInfo.underlyingToken = quote.underlyingToken;
        auctionInfo.tokenInfo.settlementToken = quote.settlementToken;
        auctionInfo.pricingInfo.notional = quote.notional;
        strike = quote.strike;
        expiry = quote.expiry;
        earliestExercise = 0;
        _mint(optionReceiver, quote.notional);
        string memory __name = IERC20Metadata(quote.underlyingToken).name();
        string memory __symbol = IERC20Metadata(quote.underlyingToken).symbol();
        _name = string(abi.encodePacked("Call ", __name));
        _symbol = string(abi.encodePacked("Call ", __symbol));
        _decimals = IERC20Metadata(quote.underlyingToken).decimals();
    }

    function handleAuctionBid(
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
        if (msg.sender != router) {
            revert();
        }

        DataTypes.CallBidPreview memory preview = previewCallBid(
            relBid,
            amount,
            _refSpot,
            _data
        );

        if (preview.status != DataTypes.BidStatus.Success) {
            revert();
        }

        // Extract the values from the preview
        settlementToken = preview.settlementToken;
        _strike = preview.strike;
        _expiry = preview.expiry;
        _earliestExercise = preview.earliestExercise;
        _premium = preview.premium;
        _oracleSpotPrice = preview.oracleSpotPrice;

        expiry = _expiry;
        earliestExercise = _earliestExercise;
        strike = _strike;
        _mint(optionReceiver, amount);
    }

    function handleOptionExercise(
        address exerciser,
        address underlyingReceiver,
        uint256 underlyingAmount
    ) external returns (address settlementToken, uint256 settlementAmount) {
        if (msg.sender != router) {
            revert();
        }
        if (!callWritten()) {
            revert();
        }
        if (block.timestamp > expiry || block.timestamp < earliestExercise) {
            revert();
        }
        settlementToken = auctionInfo.tokenInfo.settlementToken;
        settlementAmount =
            (strike * underlyingAmount) /
            auctionInfo.pricingInfo.notional;
        _burn(exerciser, underlyingAmount);
        IERC20Metadata(auctionInfo.tokenInfo.underlyingToken).safeTransfer(
            underlyingReceiver,
            underlyingAmount
        );
        emit OptionExercised(exerciser);
    }

    function handleBorrow(
        address borrower,
        address underlyingReceiver,
        uint256 underlyingAmount
    ) external returns (address settlementToken, uint256 collateralAmount) {
        if (msg.sender != router) {
            revert();
        }
        if (!callWritten()) {
            revert();
        }
        if (block.timestamp > expiry || block.timestamp < earliestExercise) {
            revert();
        }
        if (!auctionInfo.advancedOptions.borrowingAllowed) {
            revert();
        }
        settlementToken = auctionInfo.tokenInfo.settlementToken;
        collateralAmount =
            (strike * underlyingAmount) /
            auctionInfo.pricingInfo.notional;
        borrowedUnderlyingAmounts[borrower] += underlyingAmount;
        _burn(borrower, underlyingAmount);
        IERC20Metadata(auctionInfo.tokenInfo.underlyingToken).safeTransfer(
            underlyingReceiver,
            underlyingAmount
        );
    }

    function handleRepay(
        address borrower,
        address collateralReceiver,
        uint256 underlyingAmount
    )
        external
        returns (address underlyingToken, uint256 unlockedCollateralAmount)
    {
        if (msg.sender != router) {
            revert();
        }
        if (!callWritten()) {
            revert();
        }
        if (block.timestamp > expiry || block.timestamp < earliestExercise) {
            revert();
        }
        if (underlyingAmount > borrowedUnderlyingAmounts[borrower]) {
            revert();
        }
        if (!auctionInfo.advancedOptions.borrowingAllowed) {
            revert();
        }
        underlyingToken = auctionInfo.tokenInfo.underlyingToken;
        unlockedCollateralAmount =
            (strike * underlyingAmount) /
            auctionInfo.pricingInfo.notional;
        borrowedUnderlyingAmounts[borrower] -= underlyingAmount;
        _mint(borrower, underlyingAmount);
        IERC20Metadata(auctionInfo.tokenInfo.settlementToken).safeTransfer(
            collateralReceiver,
            unlockedCollateralAmount
        );
    }

    function handleOnChainVoting(address delegate) external {
        if (msg.sender != owner) {
            revert();
        }
        if (!auctionInfo.advancedOptions.votingDelegationAllowed) {
            revert();
        }
        ERC20Votes(auctionInfo.tokenInfo.underlyingToken).delegate(delegate);
    }

    function handleOffChainVoting(bytes32 spaceId, address delegate) external {
        if (msg.sender != owner) {
            revert();
        }
        address allowedDelegateRegistry = auctionInfo
            .advancedOptions
            .allowedDelegateRegistry;
        if (allowedDelegateRegistry != address(0)) {
            revert();
        }
        // @dev: for off-chain voting via Gnosis Delegate Registry
        // see: https://docs.snapshot.org/user-guides/delegation#delegation-contract
        IDelegation(allowedDelegateRegistry).setDelegate(spaceId, delegate);
    }

    function handleWithdraw(
        address to,
        address token,
        uint256 amount
    ) external {
        if (msg.sender != router && msg.sender != owner) {
            revert();
        }
        if (callWritten() && block.timestamp <= expiry) {
            revert();
        }
        IERC20Metadata(token).safeTransfer(to, amount);
        emit Withdrawn(to, token, amount);
    }

    function transferOwnership(address newOwner) public {
        address _owner = owner;
        if (msg.sender != _owner) {
            revert();
        }
        if (_owner == newOwner) {
            revert();
        }
        owner = newOwner;
    }

    function callWritten() public view returns (bool) {
        return strike > 0;
    }

    function previewCallBid(
        uint256 relBid,
        uint256 amount,
        uint256 _refSpot,
        bytes[] memory _data
    ) public view returns (DataTypes.CallBidPreview memory preview) {
        uint256 _currAsk = currAsk();
        if (callWritten()) {
            return
                DataTypes.CallBidPreview({
                    status: DataTypes.BidStatus.AuctionAlreadySuccessful,
                    settlementToken: address(0),
                    strike: 0,
                    expiry: 0,
                    earliestExercise: 0,
                    premium: 0,
                    oracleSpotPrice: 0,
                    currAsk: _currAsk
                });
        }
        if (block.timestamp < auctionInfo.bidConditions.startTime) {
            return
                DataTypes.CallBidPreview({
                    status: DataTypes.BidStatus.AuctionNotStarted,
                    settlementToken: address(0),
                    strike: 0,
                    expiry: 0,
                    earliestExercise: 0,
                    premium: 0,
                    oracleSpotPrice: 0,
                    currAsk: _currAsk
                });
        }

        if (amount != auctionInfo.pricingInfo.notional) {
            return
                DataTypes.CallBidPreview({
                    status: DataTypes.BidStatus.InvalidAmount,
                    settlementToken: address(0),
                    strike: 0,
                    expiry: 0,
                    earliestExercise: 0,
                    premium: 0,
                    oracleSpotPrice: 0,
                    currAsk: _currAsk
                });
        }

        if (relBid < currAsk()) {
            return
                DataTypes.CallBidPreview({
                    status: DataTypes.BidStatus.PremiumTooLow,
                    settlementToken: address(0),
                    strike: 0,
                    expiry: 0,
                    earliestExercise: 0,
                    premium: 0,
                    oracleSpotPrice: 0,
                    currAsk: _currAsk
                });
        }

        uint256 oracleSpotPrice = IOracle(auctionInfo.bidConditions.oracle)
            .getPrice(
                auctionInfo.tokenInfo.underlyingToken,
                auctionInfo.tokenInfo.settlementToken,
                _refSpot,
                _data
            );

        if (_refSpot < oracleSpotPrice) {
            return
                DataTypes.CallBidPreview({
                    status: DataTypes.BidStatus.SpotPriceTooLow,
                    settlementToken: address(0),
                    strike: 0,
                    expiry: 0,
                    earliestExercise: 0,
                    premium: 0,
                    oracleSpotPrice: oracleSpotPrice,
                    currAsk: _currAsk
                });
        }

        if (
            oracleSpotPrice < auctionInfo.bidConditions.minSpot ||
            auctionInfo.bidConditions.maxSpot < oracleSpotPrice
        ) {
            return
                DataTypes.CallBidPreview({
                    status: DataTypes.BidStatus.OutOfRangeSpotPrice,
                    settlementToken: address(0),
                    strike: 0,
                    expiry: 0,
                    earliestExercise: 0,
                    premium: 0,
                    oracleSpotPrice: oracleSpotPrice,
                    currAsk: _currAsk
                });
        }

        uint256 premium = (relBid *
            auctionInfo.pricingInfo.notional *
            oracleSpotPrice) /
            BASE /
            10 **
                IERC20Metadata(auctionInfo.tokenInfo.underlyingToken)
                    .decimals();
        uint256 strikePrice = (oracleSpotPrice *
            auctionInfo.pricingInfo.relStrike) / BASE;
        uint256 expiryTime = block.timestamp + auctionInfo.pricingInfo.tenor;
        uint256 earliestExerciseTime = block.timestamp +
            auctionInfo.pricingInfo.earliestExerciseTenor;

        return
            DataTypes.CallBidPreview({
                status: DataTypes.BidStatus.Success,
                settlementToken: auctionInfo.tokenInfo.settlementToken,
                strike: strikePrice,
                expiry: expiryTime,
                earliestExercise: earliestExerciseTime,
                premium: premium,
                oracleSpotPrice: oracleSpotPrice,
                currAsk: _currAsk
            });
    }

    function currAsk() public view returns (uint256) {
        uint256 _startTime = auctionInfo.bidConditions.startTime;
        uint256 _decayTime = auctionInfo.bidConditions.decayTime;
        if (block.timestamp < _startTime) {
            return auctionInfo.bidConditions.relPremiumStart;
        } else if (block.timestamp < _startTime + _decayTime) {
            uint256 _timePassed = block.timestamp - _startTime;
            uint256 _relPremiumFloor = auctionInfo
                .bidConditions
                .relPremiumStart;
            uint256 _relPremiumStart = auctionInfo
                .bidConditions
                .relPremiumStart;
            return
                _relPremiumStart -
                ((_relPremiumStart - _relPremiumFloor) * _timePassed) /
                _decayTime;
        } else {
            return auctionInfo.bidConditions.relPremiumStart;
        }
    }
}
