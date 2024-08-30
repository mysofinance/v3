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
    bool internal _initialized;
    bool internal _optionMinted;

    DataTypes.CommonOptionInfo public commonOptionInfo;
    DataTypes.AuctionParams public auctionParams;
    DataTypes.RFQInfo public rfqInfo;
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

        commonOptionInfo.underlyingToken = _auctionInfo.underlyingToken;
        commonOptionInfo.settlementToken = _auctionInfo.settlementToken;
        commonOptionInfo.notional = _auctionInfo.notional;
        commonOptionInfo.advancedOptions = _auctionInfo.advancedOptions;

        auctionParams = _auctionInfo.auctionParams;

        _initialized = true;

        _setTokenMetadata(_auctionInfo.underlyingToken);
    }

    function initializeRFQMatch(
        address optionReceiver,
        DataTypes.RFQInfo calldata _rfqInfo
    ) external {
        if (_initialized) {
            revert();
        }
        _initialized = true;
        rfqInfo = _rfqInfo;

        // Set the common option info for the auction based on the RFQ data
        commonOptionInfo.underlyingToken = rfqInfo.commonInfo.underlyingToken;
        commonOptionInfo.settlementToken = rfqInfo.commonInfo.settlementToken;
        commonOptionInfo.notional = rfqInfo.commonInfo.notional;
        commonOptionInfo.advancedOptions = rfqInfo.commonInfo.advancedOptions;

        _optionMinted = true;
        _mint(optionReceiver, rfqInfo.commonInfo.notional);

        _setTokenMetadata(rfqInfo.commonInfo.underlyingToken);
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

        commonOptionInfo.strike = _strike;
        commonOptionInfo.expiry = _expiry;
        commonOptionInfo.earliestExercise = _earliestExercise;

        earliestExercise = _earliestExercise;

        _optionMinted = true;
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
        if (!_optionMinted) {
            revert();
        }
        if (
            block.timestamp > commonOptionInfo.expiry ||
            block.timestamp < commonOptionInfo.earliestExercise
        ) {
            revert();
        }
        settlementToken = commonOptionInfo.settlementToken;
        settlementAmount =
            (commonOptionInfo.strike * underlyingAmount) /
            commonOptionInfo.notional;
        _burn(exerciser, underlyingAmount);
        IERC20Metadata(commonOptionInfo.underlyingToken).safeTransfer(
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
        if (!_optionMinted) {
            revert();
        }
        if (
            block.timestamp > commonOptionInfo.expiry ||
            block.timestamp < commonOptionInfo.earliestExercise
        ) {
            revert();
        }
        if (!commonOptionInfo.advancedOptions.borrowingAllowed) {
            revert();
        }
        settlementToken = commonOptionInfo.settlementToken;
        collateralAmount =
            (commonOptionInfo.strike * underlyingAmount) /
            commonOptionInfo.notional;
        borrowedUnderlyingAmounts[borrower] += underlyingAmount;
        _burn(borrower, underlyingAmount);
        IERC20Metadata(commonOptionInfo.underlyingToken).safeTransfer(
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
        if (!_optionMinted) {
            revert();
        }
        if (
            block.timestamp > commonOptionInfo.expiry ||
            block.timestamp < commonOptionInfo.earliestExercise
        ) {
            revert();
        }
        if (!commonOptionInfo.advancedOptions.borrowingAllowed) {
            revert();
        }
        if (underlyingAmount > borrowedUnderlyingAmounts[borrower]) {
            revert();
        }
        underlyingToken = commonOptionInfo.underlyingToken;
        unlockedCollateralAmount =
            (commonOptionInfo.strike * underlyingAmount) /
            commonOptionInfo.notional;
        borrowedUnderlyingAmounts[borrower] -= underlyingAmount;
        _mint(borrower, underlyingAmount);
        IERC20Metadata(commonOptionInfo.settlementToken).safeTransfer(
            collateralReceiver,
            unlockedCollateralAmount
        );
    }

    function handleOnChainVoting(address delegate) external {
        if (msg.sender != owner) {
            revert();
        }
        if (!commonOptionInfo.advancedOptions.votingDelegationAllowed) {
            revert();
        }
        ERC20Votes(commonOptionInfo.underlyingToken).delegate(delegate);
    }

    function handleOffChainVoting(bytes32 spaceId, address delegate) external {
        if (msg.sender != owner) {
            revert();
        }
        address allowedDelegateRegistry = commonOptionInfo
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
        if (_optionMinted && block.timestamp <= commonOptionInfo.expiry) {
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

    function previewCallBid(
        uint256 relBid,
        uint256 amount,
        uint256 _refSpot,
        bytes[] memory _data
    ) public view returns (DataTypes.CallBidPreview memory preview) {
        uint256 _currAsk = currAsk();
        if (_optionMinted) {
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
        if (block.timestamp < auctionParams.startTime) {
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

        if (amount != commonOptionInfo.notional) {
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

        uint256 oracleSpotPrice = IOracle(auctionParams.oracle).getPrice(
            commonOptionInfo.underlyingToken,
            commonOptionInfo.settlementToken,
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
            oracleSpotPrice < auctionParams.minSpot ||
            oracleSpotPrice > auctionParams.maxSpot
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
            commonOptionInfo.notional *
            oracleSpotPrice) /
            BASE /
            10 ** IERC20Metadata(commonOptionInfo.underlyingToken).decimals();
        uint256 strikePrice = (oracleSpotPrice * auctionParams.relStrike) /
            BASE;
        uint256 expiryTime = block.timestamp + auctionParams.tenor;
        uint256 earliestExerciseTime = block.timestamp +
            auctionParams.earliestExerciseTenor;

        return
            DataTypes.CallBidPreview({
                status: DataTypes.BidStatus.Success,
                settlementToken: commonOptionInfo.settlementToken,
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

    function _setTokenMetadata(address underlyingToken) internal {
        string memory __name = IERC20Metadata(underlyingToken).name();
        string memory __symbol = IERC20Metadata(underlyingToken).symbol();
        _name = string(abi.encodePacked("Call ", __name));
        _symbol = string(abi.encodePacked("Call ", __symbol));
        _decimals = IERC20Metadata(underlyingToken).decimals();
    }
}
