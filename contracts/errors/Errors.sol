// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library Errors {
    error FeeHandlerAlreadySet();
    error InvalidBid();
    error InvalidBorrowAmount();
    error InvalidBorrowCap();
    error InvalidBorrowTime();
    error InvalidEarliestExercise();
    error InvalidEarliestExerciseTenor();
    error InvalidExpiry();
    error InvalidExercise();
    error InvalidExerciseAmount();
    error InvalidExerciseTime();
    error InvalidGetEscrowsQuery();
    error InvalidNotional();
    error InvalidOracle();
    error InvalidProtocolFees();
    error InvalidRelPremiums();
    error InvalidRepayAmount();
    error InvalidRepayTime();
    error InvalidSender();
    error InvalidMinMaxSpot();
    error InvalidStrike();
    error InvalidTakeQuote();
    error InvalidTenor();
    error InvalidTokenPair();
    error InvalidWithdraw();
    error NoAllowedDelegateRegistry();
    error NoOptionMinted();
    error NotAnEscrow();
    error NothingToRepay();
    error OwnerAlreadySet();
    error SwapQuoteAlreadyUsed();
    error SwapQuoteExpired();
    error SwapQuotePaused();
    error VotingDelegationNotAllowed();
}
