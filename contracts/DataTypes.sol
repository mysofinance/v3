// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library DataTypes {
    struct CommonOptionInfo {
        address underlyingToken;
        address settlementToken;
        uint256 notional;
        uint256 strike;
        uint256 expiry;
        uint256 earliestExercise;
        AdvancedOptions advancedOptions;
    }

    struct AuctionParams {
        uint256 relStrike;
        uint256 tenor;
        uint256 earliestExerciseTenor;
        uint256 relPremiumStart;
        uint256 relPremiumFloor;
        uint256 decayTime;
        uint256 minSpot;
        uint256 maxSpot;
        uint256 startTime;
        address oracle;
    }

    struct RFQParams {
        uint256 premium;
        uint256 validUntil;
        bytes signature;
    }

    struct AdvancedOptions {
        bool borrowingAllowed;
        bool votingDelegationAllowed;
        address allowedDelegateRegistry;
    }

    struct AuctionInfo {
        address underlyingToken;
        address settlementToken;
        uint256 notional;
        AuctionParams auctionParams;
        AdvancedOptions advancedOptions;
    }

    struct RFQInfo {
        CommonOptionInfo commonInfo;
        RFQParams rfqParams;
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
