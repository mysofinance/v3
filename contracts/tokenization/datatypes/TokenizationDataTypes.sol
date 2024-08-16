// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library TokenizationDataTypes {
    struct AllowedCalls {
        address allowedCaller;
        address allowedTarget;
        // for example, "call(address,uint256)"
        string allowedMethod;
    }

    struct BaseMintConfig {
        bool remintable;
        AllowedCalls[] allowedOTokenCalls;
        bool hasERC20Votes;
        address votingDelegate;
        address delegateRegistry;
        bytes32 spaceId;
        bool transferrable;
        bool reverseExercisable;
    }

    struct MintConfig {
        address underlying;
        address settlementToken;
        uint256 strike;
        uint256 expiry;
        uint256 earliestExercise;
        BaseMintConfig baseMintConfig;
    }
}
