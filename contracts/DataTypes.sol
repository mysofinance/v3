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
        uint128 notional;
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
        uint128 premium;
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
        InvalidProtocolFees
    }

    struct BidPreview {
        BidStatus status;
        address settlementToken;
        address underlyingToken;
        uint128 strike;
        uint48 expiry;
        uint48 earliestExercise;
        uint128 premium;
        address premiumToken;
        uint256 oracleSpotPrice;
        uint64 currAsk;
        uint128 matchFeeProtocol;
        uint128 matchFeeDistPartner;
    }

    enum RFQStatus {
        Expired,
        InvalidQuote,
        AlreadyExecuted,
        QuotesPaused,
        Success
    }

    struct TakeQuotePreview {
        RFQStatus status;
        bytes32 msgHash;
        address quoter;
        uint128 premium;
        address premiumToken;
        uint128 matchFeeProtocol;
        uint128 matchFeeDistPartner;
    }

    struct SwapQuote {
        address takerGiveToken;
        uint256 takerGiveAmount;
        address makerGiveToken;
        uint256 makerGiveAmount;
        uint256 validUntil;
        bytes signature;
    }

    struct TakeSwapQuotePreview {
        RFQStatus status;
        bytes32 msgHash;
        address quoter;
    }
}
