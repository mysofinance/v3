// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library AuctionDataTypes {
    enum AuctionStatus {
        NoAuction,
        NotStarted,
        Live,
        Ended,
        Matched,
        Withdrawn
    }

    struct AuctionConfig {
        uint256 startTime;
        uint256 notional;
        uint256 relStrike;
        uint256 tenor;
        uint256 earliestExerciseTenor;
        uint256 minRelPremium;
        uint256 maxRelPremium;
        uint256 minSpot;
        uint256 maxSpot;
        uint256 duration;
        bool autoRestart;
    }

    enum BidPreviewResult {
        AuctionNotLive,
        BidTooLow,
        SpotAboveRefSpot,
        SpotOutOfRange,
        Success
    }

    struct BidPreview {
        uint256 absPremiumWithoutFee;
        uint256 fee;
        uint256 notional;
        uint256 oracleSpotPrice;
        uint256 strike;
        uint256 expiry;
        uint256 earliestExercise;
        address premiumToken;
        BidPreviewResult result;
    }
}
