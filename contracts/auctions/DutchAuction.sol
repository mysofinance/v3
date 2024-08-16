// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AuctionDataTypes} from "./datatypes/AuctionDataTypes.sol";
import {TokenizationDataTypes} from "../tokenization/datatypes/TokenizationDataTypes.sol";
import {BTokenImpl} from "../tokenization/BTokenImpl.sol";
import {TokenizationFactory} from "../tokenization/TokenizationFactory.sol";
import {IOracle} from "./interfaces/IOracle.sol";

contract DutchAuction {
    using SafeERC20 for IERC20Metadata;

    uint256 constant BASE = 1 ether;
    uint256 constant FEE = 0.15 ether;
    uint256 constant DIST_FEE_SHARE = 0.2 ether;

    uint256 public latestAuctionIdx;

    address public immutable underlyingToken;
    address public immutable settlementToken;
    address public immutable oracle;
    address public immutable tokenizationFactory;
    address public immutable protocolFeeCollector;
    bool public immutable callWriting;

    mapping(uint256 auctionIdx => AuctionDataTypes.AuctionConfig auctionConfig)
        public auctionConfigs;
    mapping(uint256 auctionIdx => TokenizationDataTypes.BaseMintConfig baseMintConfigs)
        public baseMintConfigs;
    mapping(uint256 auctionIdx => address auctionOwner) public auctionOwners;
    mapping(uint256 auctionIdx => bool isMatched) public auctionMatched;
    mapping(uint256 auctionIdx => bool isWithdrawn) public auctionWithdrawn;
    mapping(address user => uint256[] auctionIdx) public auctionIdxsPerUser;

    mapping(address bToken => bool isBToken) internal _isBToken;
    mapping(address distPartner => bool isDistPartner) internal _isDistPartner;
    mapping(uint256 auctionIdx => address distPartner) public distPartners;

    error BidFailed(AuctionDataTypes.BidPreviewResult);

    constructor(
        address _underlyingToken,
        address _settlementToken,
        bool _callWriting,
        address _oracle,
        address _tokenizationFactory,
        address _protocolFeeCollector
    ) {
        underlyingToken = _underlyingToken;
        settlementToken = _settlementToken;
        callWriting = _callWriting;
        oracle = _oracle;
        tokenizationFactory = _tokenizationFactory;
        protocolFeeCollector = _protocolFeeCollector;
    }

    function createAuction(
        AuctionDataTypes.AuctionConfig memory _auctionConfig,
        TokenizationDataTypes.BaseMintConfig memory _baseMintConfig,
        address _distPartner
    ) external {
        _createAuction(
            msg.sender,
            _auctionConfig,
            _baseMintConfig,
            _distPartner
        );
    }

    function redeemBTokenAndCreateAuction(
        address _bToken,
        AuctionDataTypes.AuctionConfig memory _auctionConfig,
        TokenizationDataTypes.BaseMintConfig memory _baseMintConfig,
        address _distPartner
    ) external {
        if (!_isBToken[_bToken]) {
            revert();
        }
        BTokenImpl(_bToken).redeemOnBehalf(msg.sender);
        _createAuction(
            msg.sender,
            _auctionConfig,
            _baseMintConfig,
            _distPartner
        );
    }

    function withdraw(address _to, uint256 _auctionIdx) external {
        AuctionDataTypes.AuctionStatus auctionStatus = getAuctionStatus(
            _auctionIdx
        );
        if (
            auctionStatus == AuctionDataTypes.AuctionStatus.NoAuction ||
            auctionStatus == AuctionDataTypes.AuctionStatus.Matched ||
            auctionStatus == AuctionDataTypes.AuctionStatus.Withdrawn
        ) {
            revert();
        }
        if (msg.sender != auctionOwners[_auctionIdx]) {
            revert();
        }
        AuctionDataTypes.AuctionConfig memory auctionConfig = auctionConfigs[
            _auctionIdx
        ];
        auctionWithdrawn[_auctionIdx] = true;
        IERC20Metadata(underlyingToken).safeTransfer(
            _to,
            auctionConfig.notional
        );
    }
    function bidAndExecute(
        uint256 _auctionIdx,
        address _oTokenTo,
        uint256 _relPremiumBid,
        uint256 _refSpot,
        bytes[] memory _data
    ) external {
        AuctionDataTypes.BidPreview memory bidPreview = previewBid(
            _auctionIdx,
            _relPremiumBid,
            _refSpot,
            _data
        );

        if (bidPreview.result != AuctionDataTypes.BidPreviewResult.Success) {
            revert BidFailed(bidPreview.result);
        }

        (uint256 distFee, uint256 protocolFee) = _calculateFees(
            bidPreview,
            _auctionIdx
        );

        address auctionOwner = auctionOwners[_auctionIdx];

        _mintTokens(_auctionIdx, _oTokenTo, auctionOwner, bidPreview);

        _handleTransfers(
            bidPreview,
            auctionOwner,
            distFee,
            protocolFee,
            _auctionIdx
        );
    }

    function getAuctionStatus(
        uint256 _auctionIdx
    ) public view returns (AuctionDataTypes.AuctionStatus status) {
        if (_auctionIdx > latestAuctionIdx) {
            status = AuctionDataTypes.AuctionStatus.NoAuction;
        } else {
            AuctionDataTypes.AuctionConfig
                memory auctionConfig = auctionConfigs[_auctionIdx];
            if (block.timestamp < auctionConfig.startTime) {
                status = AuctionDataTypes.AuctionStatus.NotStarted;
            } else if (auctionMatched[_auctionIdx]) {
                status = AuctionDataTypes.AuctionStatus.Matched;
            } else if (
                block.timestamp >
                auctionConfig.startTime + auctionConfig.duration &&
                !auctionConfig.autoRestart
            ) {
                status = AuctionDataTypes.AuctionStatus.Ended;
            } else if (auctionWithdrawn[_auctionIdx]) {
                status = AuctionDataTypes.AuctionStatus.Withdrawn;
            } else {
                status = AuctionDataTypes.AuctionStatus.Live;
            }
        }
    }

    function currAsk(
        uint256 _auctionIdx
    )
        public
        view
        returns (uint256 currRelPremium, uint256 currRelPremiumWithFee)
    {
        AuctionDataTypes.AuctionStatus auctionStatus = getAuctionStatus(
            _auctionIdx
        );
        if (auctionStatus != AuctionDataTypes.AuctionStatus.Live) {
            currRelPremium = type(uint256).max;
        } else {
            AuctionDataTypes.AuctionConfig
                memory auctionConfig = auctionConfigs[_auctionIdx];
            uint256 _timePassed = block.timestamp -
                (auctionConfig.startTime +
                    ((block.timestamp - auctionConfig.startTime) /
                        auctionConfig.duration) *
                    auctionConfig.duration);
            currRelPremium =
                auctionConfig.minRelPremium +
                ((auctionConfig.maxRelPremium - auctionConfig.minRelPremium) *
                    _timePassed) /
                auctionConfig.duration;
        }
        currRelPremiumWithFee = (currRelPremium * (BASE + FEE)) / BASE;
    }

    function previewBid(
        uint256 _auctionIdx,
        uint256 _relPremiumBid,
        uint256 _refSpot,
        bytes[] memory _data
    ) public view returns (AuctionDataTypes.BidPreview memory bidPreview) {
        AuctionDataTypes.AuctionStatus auctionStatus = getAuctionStatus(
            _auctionIdx
        );
        if (auctionStatus != AuctionDataTypes.AuctionStatus.Live) {
            bidPreview.result = AuctionDataTypes
                .BidPreviewResult
                .AuctionNotLive;
            return bidPreview;
        }

        AuctionDataTypes.AuctionConfig memory auctionConfig = auctionConfigs[
            _auctionIdx
        ];

        (uint256 currRelPremium, uint256 currRelPremiumWithFee) = currAsk(
            _auctionIdx
        );

        // @dev: the rel. premium after fees needs to be gte than current ask
        if (_relPremiumBid < currRelPremiumWithFee) {
            bidPreview.result = AuctionDataTypes.BidPreviewResult.BidTooLow;
            return bidPreview;
        }
        uint256 oracleSpotPrice = IOracle(oracle).getPrice(
            underlyingToken,
            settlementToken,
            _refSpot,
            _data
        );

        if (_refSpot < oracleSpotPrice) {
            bidPreview.result = AuctionDataTypes
                .BidPreviewResult
                .SpotAboveRefSpot;
            return bidPreview;
        }

        if (
            oracleSpotPrice < auctionConfig.minSpot ||
            auctionConfig.maxSpot < oracleSpotPrice
        ) {
            bidPreview.result = AuctionDataTypes
                .BidPreviewResult
                .SpotOutOfRange;
            return bidPreview;
        }
        uint256 notional = auctionConfig.notional;
        // @dev: for case of call writing, need to convert from notional ccy to settlement ccy
        // @dev: for put writing, notional ccy is already denominated in settlement ccy
        uint256 absPremiumWithoutFee = callWriting
            ? ((currRelPremium * oracleSpotPrice * notional) /
                10 ** IERC20Metadata(underlyingToken).decimals()) / BASE
            : (currRelPremium * notional) / BASE;
        uint256 absPremiumWithFee = callWriting
            ? ((currRelPremiumWithFee * oracleSpotPrice * notional) /
                10 ** IERC20Metadata(underlyingToken).decimals()) / BASE
            : (currRelPremiumWithFee * notional) / BASE;
        uint256 fee = absPremiumWithFee - absPremiumWithoutFee;
        uint256 strike = (oracleSpotPrice * auctionConfig.relStrike) / BASE;
        uint256 expiry = block.timestamp + auctionConfig.tenor;
        uint256 earliestExercise = block.timestamp +
            auctionConfig.earliestExerciseTenor;

        bidPreview.absPremiumWithoutFee = absPremiumWithoutFee;
        bidPreview.fee = fee;
        bidPreview.notional = auctionConfig.notional;
        bidPreview.oracleSpotPrice = oracleSpotPrice;
        bidPreview.strike = strike;
        bidPreview.expiry = expiry;
        bidPreview.earliestExercise = earliestExercise;
        bidPreview.premiumToken = callWriting
            ? settlementToken
            : underlyingToken;
        bidPreview.result = AuctionDataTypes.BidPreviewResult.Success;
    }

    function isValidAuctionConfig(
        AuctionDataTypes.AuctionConfig memory _auctionConfig
    ) public view returns (bool) {
        if (_auctionConfig.startTime < block.timestamp) {
            return false;
        }
        if (_auctionConfig.notional == 0) {
            return false;
        }
        if (_auctionConfig.relStrike == 0) {
            return false;
        }
        if (_auctionConfig.tenor < 1 days) {
            return false;
        }
        if (
            _auctionConfig.tenor < _auctionConfig.earliestExerciseTenor + 1 days
        ) {
            return false;
        }
        if (_auctionConfig.minRelPremium == 0) {
            return false;
        }
        if (_auctionConfig.maxRelPremium == 0) {
            return false;
        }
        if (_auctionConfig.minRelPremium > _auctionConfig.maxRelPremium) {
            return false;
        }
        if (_auctionConfig.minSpot == 0) {
            return false;
        }
        if (_auctionConfig.maxSpot == 0) {
            return false;
        }
        if (_auctionConfig.minSpot > _auctionConfig.maxSpot) {
            return false;
        }
        if (_auctionConfig.duration < 1 hours) {
            return false;
        }
        return true;
    }

    function _createAuction(
        address _auctionOwner,
        AuctionDataTypes.AuctionConfig memory _auctionConfig,
        TokenizationDataTypes.BaseMintConfig memory _baseMintConfig,
        address _distPartner
    ) internal {
        if (!isValidAuctionConfig(_auctionConfig)) {
            revert();
        }
        if (!_isDistPartner[_distPartner]) {
            revert();
        }

        uint256 _latestAuctionIdx = latestAuctionIdx;
        auctionIdxsPerUser[_auctionOwner].push(_latestAuctionIdx);

        TokenizationDataTypes.BaseMintConfig
            storage __baseMintConfig = baseMintConfigs[_latestAuctionIdx];
        __baseMintConfig.remintable = _baseMintConfig.remintable;
        __baseMintConfig.hasERC20Votes = _baseMintConfig.hasERC20Votes;
        __baseMintConfig.votingDelegate = _baseMintConfig.votingDelegate;
        __baseMintConfig.delegateRegistry = _baseMintConfig.delegateRegistry;
        __baseMintConfig.spaceId = _baseMintConfig.spaceId;
        __baseMintConfig.transferrable = _baseMintConfig.transferrable;
        __baseMintConfig.reverseExercisable = _baseMintConfig
            .reverseExercisable;

        for (uint256 i; i < _baseMintConfig.allowedOTokenCalls.length; ) {
            __baseMintConfig.allowedOTokenCalls.push(
                _baseMintConfig.allowedOTokenCalls[i]
            );
            unchecked {
                ++i;
            }
        }

        auctionConfigs[_latestAuctionIdx] = _auctionConfig;
        auctionOwners[_latestAuctionIdx] = _auctionOwner;

        distPartners[_latestAuctionIdx] = _distPartner;
        latestAuctionIdx++;

        IERC20Metadata(underlyingToken).safeTransferFrom(
            _auctionOwner,
            address(this),
            _auctionConfig.notional
        );
    }

    function _calculateFees(
        AuctionDataTypes.BidPreview memory bidPreview,
        uint256 _auctionIdx
    ) internal view returns (uint256 distFee, uint256 protocolFee) {
        address disPartner = distPartners[_auctionIdx];
        address _protocolFeeCollector = protocolFeeCollector;

        distFee = disPartner == _protocolFeeCollector
            ? 0
            : (bidPreview.fee * DIST_FEE_SHARE) / BASE;
        protocolFee = bidPreview.fee - distFee;
    }

    function _mintTokens(
        uint256 _auctionIdx,
        address _oTokenTo,
        address auctionOwner,
        AuctionDataTypes.BidPreview memory bidPreview
    ) internal {
        TokenizationDataTypes.MintConfig memory mintConfig;
        mintConfig.baseMintConfig = baseMintConfigs[_auctionIdx];
        mintConfig.underlying = underlyingToken;
        mintConfig.settlementToken = settlementToken;
        mintConfig.strike = bidPreview.strike;
        mintConfig.expiry = bidPreview.expiry;
        mintConfig.earliestExercise = bidPreview.earliestExercise;

        (, address bToken, ) = TokenizationFactory(tokenizationFactory).mint(
            _oTokenTo,
            auctionOwner,
            bidPreview.notional,
            mintConfig
        );
        _isBToken[bToken] = true;
    }

    function _handleTransfers(
        AuctionDataTypes.BidPreview memory bidPreview,
        address auctionOwner,
        uint256 distFee,
        uint256 protocolFee,
        uint256 _auctionIdx
    ) internal {
        IERC20Metadata(bidPreview.premiumToken).safeTransferFrom(
            msg.sender,
            auctionOwner,
            bidPreview.absPremiumWithoutFee
        );

        if (distFee > 0) {
            IERC20Metadata(bidPreview.premiumToken).safeTransferFrom(
                msg.sender,
                distPartners[_auctionIdx],
                distFee
            );
        }

        IERC20Metadata(bidPreview.premiumToken).safeTransferFrom(
            msg.sender,
            protocolFeeCollector,
            protocolFee
        );
    }
}
