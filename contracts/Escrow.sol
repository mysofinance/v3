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
    uint256 public earliestExercise;
    bool public isAuction;
    bool public optionMinted;

    DataTypes.OptionInfo public optionInfo;
    DataTypes.AuctionParams public auctionParams;
    DataTypes.RFQInitialization public rfqInitialization;
    mapping(address => uint256) public borrowedUnderlyingAmounts;

    event OptionExercised(address indexed exerciser);
    event Withdrawn(address indexed to, address indexed token, uint256 amount);

    function initializeAuction(
        address _router,
        address _owner,
        DataTypes.AuctionInitialization calldata _auctionInfo
    ) external initializer {
        optionInfo.underlyingToken = _auctionInfo.underlyingToken;
        optionInfo.settlementToken = _auctionInfo.settlementToken;
        optionInfo.notional = _auctionInfo.notional;
        optionInfo.advancedEscrowSettings = _auctionInfo.advancedEscrowSettings;

        auctionParams = _auctionInfo.auctionParams;

        isAuction = true;
        _initialize(_router, _owner, _auctionInfo.underlyingToken);
    }

    function initializeRFQMatch(
        address _router,
        address _owner,
        address optionReceiver,
        DataTypes.RFQInitialization calldata _rfqInfo
    ) external initializer {
        rfqInitialization = _rfqInfo;

        optionInfo.underlyingToken = rfqInitialization
            .optionInfo
            .underlyingToken;
        optionInfo.settlementToken = rfqInitialization
            .optionInfo
            .settlementToken;
        optionInfo.notional = rfqInitialization.optionInfo.notional;
        optionInfo.advancedEscrowSettings = rfqInitialization
            .optionInfo
            .advancedEscrowSettings;

        optionMinted = true;
        _mint(optionReceiver, rfqInitialization.optionInfo.notional);

        _initialize(
            _router,
            _owner,
            rfqInitialization.optionInfo.underlyingToken
        );
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
        DataTypes.BidPreview memory preview = previewBid(
            relBid,
            amount,
            _refSpot,
            _data
        );

        if (preview.status != DataTypes.BidStatus.Success) {
            revert();
        }

        settlementToken = preview.settlementToken;
        _strike = preview.strike;
        _expiry = preview.expiry;
        _earliestExercise = preview.earliestExercise;
        _premium = preview.premium;
        _oracleSpotPrice = preview.oracleSpotPrice;

        optionInfo.strike = _strike;
        optionInfo.expiry = _expiry;
        optionInfo.earliestExercise = _earliestExercise;

        earliestExercise = _earliestExercise;

        optionMinted = true;
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
        if (!optionMinted) {
            revert();
        }
        if (
            block.timestamp > optionInfo.expiry ||
            block.timestamp < optionInfo.earliestExercise
        ) {
            revert();
        }
        settlementToken = optionInfo.settlementToken;
        settlementAmount =
            (optionInfo.strike * underlyingAmount) /
            optionInfo.notional;
        _burn(exerciser, underlyingAmount);
        IERC20Metadata(optionInfo.underlyingToken).safeTransfer(
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
        if (!optionMinted) {
            revert();
        }
        if (
            block.timestamp > optionInfo.expiry ||
            block.timestamp < optionInfo.earliestExercise
        ) {
            revert();
        }
        if (!optionInfo.advancedEscrowSettings.borrowingAllowed) {
            revert();
        }
        settlementToken = optionInfo.settlementToken;
        collateralAmount =
            (optionInfo.strike * underlyingAmount) /
            optionInfo.notional;
        borrowedUnderlyingAmounts[borrower] += underlyingAmount;
        _burn(borrower, underlyingAmount);
        IERC20Metadata(optionInfo.underlyingToken).safeTransfer(
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
        if (!optionMinted) {
            revert();
        }
        if (
            block.timestamp > optionInfo.expiry ||
            block.timestamp < optionInfo.earliestExercise
        ) {
            revert();
        }
        if (!optionInfo.advancedEscrowSettings.borrowingAllowed) {
            revert();
        }
        if (underlyingAmount > borrowedUnderlyingAmounts[borrower]) {
            revert();
        }
        underlyingToken = optionInfo.underlyingToken;
        unlockedCollateralAmount =
            (optionInfo.strike * underlyingAmount) /
            optionInfo.notional;
        borrowedUnderlyingAmounts[borrower] -= underlyingAmount;
        _mint(borrower, underlyingAmount);
        IERC20Metadata(optionInfo.settlementToken).safeTransfer(
            collateralReceiver,
            unlockedCollateralAmount
        );
    }

    function handleOnChainVoting(address delegate) external {
        if (msg.sender != owner) {
            revert();
        }
        if (!optionInfo.advancedEscrowSettings.votingDelegationAllowed) {
            revert();
        }
        ERC20Votes(optionInfo.underlyingToken).delegate(delegate);
    }

    function handleOffChainVoting(bytes32 spaceId, address delegate) external {
        if (msg.sender != owner) {
            revert();
        }
        address allowedDelegateRegistry = optionInfo
            .advancedEscrowSettings
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
        if (optionMinted && block.timestamp <= optionInfo.expiry) {
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

    function previewBid(
        uint256 relBid,
        uint256 amount,
        uint256 _refSpot,
        bytes[] memory _data
    ) public view returns (DataTypes.BidPreview memory preview) {
        uint256 _currAsk = currAsk();
        if (!isAuction) {
            return
                DataTypes.BidPreview({
                    status: DataTypes.BidStatus.NotAnAuction,
                    settlementToken: address(0),
                    strike: 0,
                    expiry: 0,
                    earliestExercise: 0,
                    premium: 0,
                    oracleSpotPrice: 0,
                    currAsk: _currAsk
                });
        }
        if (optionMinted) {
            return
                DataTypes.BidPreview({
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
        if (block.timestamp < auctionParams.startTime) {
            return
                DataTypes.BidPreview({
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

        if (amount != optionInfo.notional) {
            return
                DataTypes.BidPreview({
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
                DataTypes.BidPreview({
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

        uint256 oracleSpotPrice = IOracle(auctionParams.oracle).getPrice(
            optionInfo.underlyingToken,
            optionInfo.settlementToken,
            _refSpot,
            _data
        );

        if (_refSpot < oracleSpotPrice) {
            return
                DataTypes.BidPreview({
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
            oracleSpotPrice < auctionParams.minSpot ||
            oracleSpotPrice > auctionParams.maxSpot
        ) {
            return
                DataTypes.BidPreview({
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

        if (
            IERC20Metadata(optionInfo.underlyingToken).balanceOf(
                address(this)
            ) < amount
        ) {
            return
                DataTypes.BidPreview({
                    status: DataTypes.BidStatus.InsufficientFunding,
                    settlementToken: address(0),
                    strike: 0,
                    expiry: 0,
                    earliestExercise: 0,
                    premium: 0,
                    oracleSpotPrice: oracleSpotPrice,
                    currAsk: _currAsk
                });
        }

        uint256 premium = (relBid * optionInfo.notional * oracleSpotPrice) /
            BASE /
            10 ** IERC20Metadata(optionInfo.underlyingToken).decimals();
        uint256 strikePrice = (oracleSpotPrice * auctionParams.relStrike) /
            BASE;
        uint256 expiryTime = block.timestamp + auctionParams.tenor;
        uint256 earliestExerciseTime = block.timestamp +
            auctionParams.earliestExerciseTenor;

        return
            DataTypes.BidPreview({
                status: DataTypes.BidStatus.Success,
                settlementToken: optionInfo.settlementToken,
                strike: strikePrice,
                expiry: expiryTime,
                earliestExercise: earliestExerciseTime,
                premium: premium,
                oracleSpotPrice: oracleSpotPrice,
                currAsk: _currAsk
            });
    }

    function currAsk() public view returns (uint256) {
        uint256 _startTime = auctionParams.startTime;
        uint256 _decayTime = auctionParams.decayTime;
        if (block.timestamp < _startTime) {
            return auctionParams.relPremiumStart;
        } else if (block.timestamp < _startTime + _decayTime) {
            uint256 _timePassed = block.timestamp - _startTime;
            uint256 _relPremiumFloor = auctionParams.relPremiumFloor;
            uint256 _relPremiumStart = auctionParams.relPremiumStart;
            return
                _relPremiumStart -
                ((_relPremiumStart - _relPremiumFloor) * _timePassed) /
                _decayTime;
        } else {
            return auctionParams.relPremiumFloor;
        }
    }

    function _initialize(
        address _router,
        address _owner,
        address underlyingToken
    ) internal {
        router = _router;
        owner = _owner;
        string memory __name = IERC20Metadata(underlyingToken).name();
        string memory __symbol = IERC20Metadata(underlyingToken).symbol();
        _name = string(abi.encodePacked("Call ", __name));
        _symbol = string(abi.encodePacked("Call ", __symbol));
        _decimals = IERC20Metadata(underlyingToken).decimals();
    }
}
