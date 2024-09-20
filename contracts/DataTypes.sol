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
        AdvancedEscrowSettings advancedEscrowSettings;
        address oracle;
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
        address oracle;
    }

    struct RFQQuote {
        uint256 premium;
        uint256 validUntil;
        bytes signature;
    }

    struct AdvancedEscrowSettings {
        bool borrowingAllowed;
        bool votingDelegationAllowed;
        address allowedDelegateRegistry;
    }

    struct AuctionInitialization {
        address underlyingToken;
        address settlementToken;
        uint256 notional;
        AuctionParams auctionParams;
        AdvancedEscrowSettings advancedEscrowSettings;
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
        uint256 strike;
        uint256 expiry;
        uint256 earliestExercise;
        uint256 premium;
        uint256 oracleSpotPrice;
        uint256 currAsk;
        uint256 protocolFee;
        uint256 distPartnerFee;
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
        uint256 protocolFee;
        uint256 distPartnerFee;
    }
}
