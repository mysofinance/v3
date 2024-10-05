// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library DataTypes {
    struct OptionInfo {
        address underlyingToken;
        uint48 expiry;
        address settlementToken;
        uint48 earliestExercise;
        uint128 notional;
        uint128 strike;
        AdvancedSettings advancedSettings;
    }

    struct AdvancedSettings {
        uint64 borrowCap;
        address oracle;
        bool premiumTokenIsUnderlying;
        bool votingDelegationAllowed;
        address allowedDelegateRegistry;
    }

    struct AuctionInitialization {
        address underlyingToken;
        address settlementToken;
        uint256 notional;
        AuctionParams auctionParams;
        AdvancedSettings advancedSettings;
    }

    struct AuctionParams {
        uint128 relStrike;
        uint48 tenor;
        uint48 earliestExerciseTenor;
        uint32 decayStartTime;
        uint32 decayDuration;
        uint64 relPremiumStart;
        uint64 relPremiumFloor;
        uint128 minSpot;
        uint128 maxSpot;
    }

    struct RFQInitialization {
        OptionInfo optionInfo;
        RFQQuote rfqQuote;
    }

    struct RFQQuote {
        uint256 premium;
        uint256 validUntil;
        bytes signature;
    }

    enum BidStatus {
        Success,
        SpotPriceTooLow,
        OutOfRangeSpotPrice,
        AuctionAlreadySuccessful,
        PremiumTooLow,
        NotAnAuction,
        InsufficientFunding,
        InvalidProtocolFees
    }

    struct BidPreview {
        BidStatus status;
        address settlementToken;
        address underlyingToken;
        uint256 strike;
        uint256 expiry;
        uint256 earliestExercise;
        uint256 premium;
        address premiumToken;
        uint256 oracleSpotPrice;
        uint256 currAsk;
        uint256 matchFeeProtocol;
        uint256 matchFeeDistPartner;
    }

    enum RFQStatus {
        Expired,
        AlreadyExecuted,
        InsufficientFunding,
        QuotesPaused,
        Success
    }

    struct TakeQuotePreview {
        RFQStatus status;
        bytes32 msgHash;
        address quoter;
        uint256 premium;
        address premiumToken;
        uint256 matchFeeProtocol;
        uint256 matchFeeDistPartner;
    }

    struct SwapQuote {
        address takerToken;
        uint256 takerAmount;
        address makerToken;
        uint256 makerAmount;
        uint256 swapRate;
        uint256 validUntil;
        bytes signature;
    }

    struct TakeSwapQuotePreview {
        RFQStatus status;
        bytes32 msgHash;
        address quoter;
    }
}
