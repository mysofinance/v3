// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library DataTypes {
    struct OptionInfo {
        address underlyingToken;
        address settlementToken;
        uint256 notional;
        uint256 strike;
        uint256 expiry;
        uint256 earliestExercise;
        AdvancedSettings advancedSettings;
    }

    struct AuctionParams {
        uint256 relStrike;
        uint256 tenor;
        uint256 earliestExerciseTenor;
        uint256 relPremiumStart;
        uint256 relPremiumFloor;
        uint256 decayDuration;
        uint256 minSpot;
        uint256 maxSpot;
        uint256 decayStartTime;
    }

    struct RFQQuote {
        uint256 premium;
        uint256 validUntil;
        bytes signature;
    }

    struct AdvancedSettings {
        address oracle;
        bool premiumPaidInUnderlying;
        bool borrowingAllowed;
        bool votingDelegationAllowed;
        address allowedDelegateRegistry;
    }

    struct AuctionInitialization {
        address underlyingToken;
        address settlementToken;
        uint256 notional;
        address oracle;
        AuctionParams auctionParams;
        AdvancedSettings advancedSettings;
    }

    struct RFQInitialization {
        OptionInfo optionInfo;
        RFQQuote rfqQuote;
    }

    enum BidStatus {
        Success,
        SpotPriceTooLow,
        OutOfRangeSpotPrice,
        AuctionAlreadySuccessful,
        PremiumTooLow,
        NotAnAuction,
        InsufficientFunding
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
        uint256 protocolFee;
        uint256 distPartnerFee;
        uint256 oracleSpotPrice;
        uint256 currAsk;
    }

    enum RFQStatus {
        Expired,
        AlreadyExecuted,
        InsufficientFunding,
        Success
    }

    struct TakeQuotePreview {
        RFQStatus status;
        bytes32 msgHash;
        address quoter;
        uint256 premium;
        address premiumToken;
        uint256 protocolFee;
        uint256 distPartnerFee;
    }
}
