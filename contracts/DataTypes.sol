// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library DataTypes {
    struct TokenInfo {
        address underlyingToken;
        address settlementToken;
    }

    struct PricingInfo {
        uint256 notional;
        uint256 relStrike;
        uint256 tenor;
        uint256 earliestExerciseTenor;
    }

    struct BidConditions {
        uint256 startTime;
        uint256 relPremiumStart;
        uint256 relPremiumFloor;
        uint256 decayTime;
        uint256 minSpot;
        uint256 maxSpot;
        address oracle;
    }

    struct AdvancedOptions {
        bool borrowingAllowed;
        bool votingDelegationAllowed;
        address allowedDelegateRegistry;
    }

    struct AuctionInfo {
        TokenInfo tokenInfo;
        PricingInfo pricingInfo;
        BidConditions bidConditions;
        AdvancedOptions advancedOptions;
    }

    enum BidStatus {
        Success,
        InvalidAmount,
        SpotPriceTooLow,
        OutOfRangeSpotPrice,
        AuctionAlreadySuccessful,
        AuctionNotStarted,
        PremiumTooLow
    }

    struct CallBidPreview {
        BidStatus status;
        address settlementToken;
        uint256 strike;
        uint256 expiry;
        uint256 earliestExercise;
        uint256 premium;
        uint256 oracleSpotPrice;
        uint256 currAsk;
    }

    struct Quote {
        address underlyingToken;
        address settlementToken;
        uint256 notional;
        uint256 strike;
        uint256 expiry;
        uint256 premium;
        uint256 validUntil;
        bytes signature;
    }
}
