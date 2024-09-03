// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { Escrow } from "../contracts/Escrow.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { DataTypes } from "../contracts/DataTypes.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {InitializableERC20} from "../contracts/utils/InitializableERC20.sol";
import {DataTypes} from "../contracts/DataTypes.sol";
import {IOracle} from "../contracts/interfaces/IOracle.sol";
import {IDelegation} from "../contracts/interfaces/IDelegation.sol";

contract EscrowFuzzTest is Test {
    Escrow public escrow;
    address public constant ROUTER = address(0x1);
    address public constant OWNER = address(0x2);
    address public constant UNDERLYING_TOKEN = address(0x3);
    address public constant SETTLEMENT_TOKEN = address(0x4);
    address public constant ORACLE = address(0x5);

    function setUp() public {
        vm.mockCall(
            UNDERLYING_TOKEN,
            abi.encodeWithSelector(IERC20Metadata.name.selector),
            abi.encode("Underlying Token")
        );
        vm.mockCall(
            UNDERLYING_TOKEN,
            abi.encodeWithSelector(IERC20Metadata.symbol.selector),
            abi.encode("UT")
        );
        vm.mockCall(
            UNDERLYING_TOKEN,
            abi.encodeWithSelector(IERC20Metadata.decimals.selector),
            abi.encode(18)
        );

        escrow = new Escrow();
    }

    function testFuzzInitializeAuction(
        uint256 notional,
        uint256 relStrike,
        uint256 tenor,
        uint256 earliestExerciseTenor,
        uint256 relPremiumStart,
        uint256 relPremiumFloor,
        uint256 decayDuration,
        uint256 minSpot,
        uint256 maxSpot
    ) public {
        vm.assume(notional > 0 && notional < 1e30);
        vm.assume(relStrike > 0.5e18 && relStrike < 2e18);
        vm.assume(tenor > 1 days && tenor < 365 days);
        vm.assume(earliestExerciseTenor < tenor - 1 days);
        vm.assume(relPremiumStart > relPremiumFloor);
        vm.assume(relPremiumStart < 0.5e18 && relPremiumFloor > 0.01e18);
        vm.assume(decayDuration > 1 hours && decayDuration < 7 days);
        vm.assume(minSpot < maxSpot && minSpot > 100e18 && maxSpot < 10000e18);

        DataTypes.AuctionInitialization memory auctionInit = DataTypes.AuctionInitialization({
            underlyingToken: UNDERLYING_TOKEN,
            settlementToken: SETTLEMENT_TOKEN,
            notional: notional,
            advancedEscrowSettings: DataTypes.AdvancedEscrowSettings({
                borrowingAllowed: true,
                votingDelegationAllowed: true,
                allowedDelegateRegistry: address(0)
            }),
            auctionParams: DataTypes.AuctionParams({
                relStrike: relStrike,
                tenor: tenor,
                earliestExerciseTenor: earliestExerciseTenor,
                relPremiumStart: relPremiumStart,
                relPremiumFloor: relPremiumFloor,
                decayStartTime: block.timestamp + 1 hours,
                decayDuration: decayDuration,
                minSpot: minSpot,
                maxSpot: maxSpot,
                oracle: ORACLE
            })
        });

        escrow.initializeAuction(ROUTER, OWNER, auctionInit);

        assertTrue(escrow.isAuction());
        assertEq(escrow.router(), ROUTER);
        assertEq(escrow.owner(), OWNER);
    }

    function testFuzzHandleAuctionBid(
        uint256 notional,
        uint256 relStrike,
        uint256 tenor,
        uint256 earliestExerciseTenor,
        uint256 relPremiumStart,
        uint256 relPremiumFloor,
        uint256 decayDuration,
        uint256 minSpot,
        uint256 maxSpot,
        uint256 relBid,
        uint256 amount,
        uint256 refSpot
    ) public {
        // Constrain fuzz inputs
        vm.assume(notional > 0 && notional < 1e30);
        vm.assume(relStrike > 0.5e18 && relStrike < 2e18);
        vm.assume(tenor > 1 days && tenor < 365 days);
        vm.assume(earliestExerciseTenor < tenor - 1 days);
        vm.assume(relPremiumStart > relPremiumFloor);
        vm.assume(relPremiumStart < 0.5e18 && relPremiumFloor > 0.01e18);
        vm.assume(decayDuration > 1 hours && decayDuration < 7 days);
        vm.assume(minSpot < maxSpot && minSpot > 100e18 && maxSpot < 10000e18);
        vm.assume(relBid >= relPremiumFloor && relBid <= relPremiumStart);
        vm.assume(amount == notional);
        vm.assume(refSpot >= minSpot && refSpot <= maxSpot);

        // Initialize auction
        DataTypes.AuctionInitialization memory auctionInit = DataTypes.AuctionInitialization({
            underlyingToken: UNDERLYING_TOKEN,
            settlementToken: SETTLEMENT_TOKEN,
            notional: notional,
            advancedEscrowSettings: DataTypes.AdvancedEscrowSettings({
                borrowingAllowed: true,
                votingDelegationAllowed: true,
                allowedDelegateRegistry: address(0)
            }),
            auctionParams: DataTypes.AuctionParams({
                relStrike: relStrike,
                tenor: tenor,
                earliestExerciseTenor: earliestExerciseTenor,
                relPremiumStart: relPremiumStart,
                relPremiumFloor: relPremiumFloor,
                decayStartTime: block.timestamp + 1 hours,
                decayDuration: decayDuration,
                minSpot: minSpot,
                maxSpot: maxSpot,
                oracle: ORACLE
            })
        });

        escrow.initializeAuction(ROUTER, OWNER, auctionInit);

        // Mock oracle call
        vm.mockCall(
            ORACLE,
            abi.encodeWithSelector(IOracle.getPrice.selector),
            abi.encode(refSpot)
        );

        address optionReceiver = address(0x6);
        bytes[] memory data = new bytes[](0);

        vm.prank(ROUTER);
        (
            address settlementToken,
            uint256 strike,
            uint256 expiry,
            uint256 earliestExercise,
            uint256 premium,
            uint256 oracleSpotPrice
        ) = escrow.handleAuctionBid(relBid, amount, optionReceiver, refSpot, data);

        assertEq(settlementToken, SETTLEMENT_TOKEN);
        assertEq(strike, (refSpot * relStrike) / 1e18);
        assertTrue(expiry > block.timestamp);
        assertTrue(earliestExercise > block.timestamp);
        assertEq(premium, (relBid * amount * refSpot) / 1e18 / 1e18);
        assertEq(oracleSpotPrice, refSpot);
    }

    function testFuzzInitializeRFQMatchAndHandleBorrow(
    uint256 notional,
    uint256 strike,
    uint256 expiry,
    uint256 earliestExercise,
    uint256 borrowAmount
) public {
    vm.assume(notional > 0 && notional < 1e30);
    vm.assume(strike > 0 && strike < 1e30);
    vm.assume(expiry > block.timestamp && expiry < block.timestamp + 365 days);
    vm.assume(earliestExercise > block.timestamp && earliestExercise < expiry - 1 days);
    vm.assume(borrowAmount > 0 && borrowAmount <= notional);

    address optionReceiver = address(0x6);
    DataTypes.RFQInitialization memory rfqInit = DataTypes.RFQInitialization({
        optionInfo: DataTypes.OptionInfo({
            underlyingToken: UNDERLYING_TOKEN,
            settlementToken: SETTLEMENT_TOKEN,
            notional: notional,
            strike: strike,
            expiry: expiry,
            earliestExercise: earliestExercise,
            advancedEscrowSettings: DataTypes.AdvancedEscrowSettings({
                borrowingAllowed: true,
                votingDelegationAllowed: true,
                allowedDelegateRegistry: address(0)
            })
        })
    });

    escrow.initializeRFQMatch(ROUTER, OWNER, optionReceiver, rfqInit);

    assertTrue(escrow.optionMinted());
    assertEq(escrow.router(), ROUTER);
    assertEq(escrow.owner(), OWNER);
    assertEq(escrow.balanceOf(optionReceiver), notional);

    // Test handleBorrow
    address borrower = address(0x7);
    address underlyingReceiver = address(0x8);

    // Mock the underlying token transfer
    vm.mockCall(
        UNDERLYING_TOKEN,
        abi.encodeWithSelector(IERC20.transfer.selector, underlyingReceiver, borrowAmount),
        abi.encode(true)
    );

    vm.prank(ROUTER);
    (address settlementToken, uint256 collateralAmount) = escrow.handleBorrow(borrower, underlyingReceiver, borrowAmount);

    assertEq(settlementToken, SETTLEMENT_TOKEN);
    assertEq(collateralAmount, (strike * borrowAmount) / notional);
    assertEq(escrow.borrowedUnderlyingAmounts(borrower), borrowAmount);
    assertEq(escrow.balanceOf(borrower), borrowAmount);
}

    function testFuzzHandleCallExercise(
        uint256 notional,
        uint256 strike,
        uint256 expiry,
        uint256 earliestExercise,
        uint256 exerciseAmount
    ) public {
        vm.assume(notional > 0 && notional < 1e30);
        vm.assume(strike > 0 && strike < 1e30);
        vm.assume(expiry > block.timestamp && expiry < block.timestamp + 365 days);
        vm.assume(earliestExercise > block.timestamp && earliestExercise < expiry - 1 days);
        vm.assume(exerciseAmount > 0 && exerciseAmount <= notional);

        // Initialize the RFQ match
        address optionReceiver = address(0x6);
        DataTypes.RFQInitialization memory rfqInit = DataTypes.RFQInitialization({
            optionInfo: DataTypes.OptionInfo({
                underlyingToken: UNDERLYING_TOKEN,
                settlementToken: SETTLEMENT_TOKEN,
                notional: notional,
                strike: strike,
                expiry: expiry,
                earliestExercise: earliestExercise,
                advancedEscrowSettings: DataTypes.AdvancedEscrowSettings({
                    borrowingAllowed: true,
                    votingDelegationAllowed: true,
                    allowedDelegateRegistry: address(0)
                })
            })
        });

        escrow.initializeRFQMatch(ROUTER, OWNER, optionReceiver, rfqInit);

        address exerciser = address(0x9);
        address underlyingReceiver = address(0x10);

        // Instead of minting directly, we transfer tokens from the option receiver
        vm.prank(optionReceiver);
        escrow.transfer(exerciser, exerciseAmount);

        // Mock the underlying token transfer
        vm.mockCall(
            UNDERLYING_TOKEN,
            abi.encodeWithSelector(IERC20.transfer.selector, underlyingReceiver, exerciseAmount),
            abi.encode(true)
        );

        // Warp to the earliest exercise time
        vm.warp(earliestExercise);

        vm.prank(ROUTER);
        (address settlementToken, uint256 settlementAmount) = escrow.handleCallExercise(exerciser, underlyingReceiver, exerciseAmount);

        assertEq(settlementToken, SETTLEMENT_TOKEN);
        assertEq(settlementAmount, (strike * exerciseAmount) / notional);
        assertEq(escrow.balanceOf(exerciser), 0);
    }

    function testFuzzHandleCallExerciseFailsBeforeEarliestExercise(
        uint256 notional,
        uint256 strike,
        uint256 expiry,
        uint256 earliestExercise,
        uint256 exerciseAmount,
        uint256 exerciseTime
    ) public {
        vm.assume(notional > 0 && notional < 1e30);
        vm.assume(strike > 0 && strike < 1e30);
        vm.assume(expiry > block.timestamp && expiry < block.timestamp + 365 days);
        vm.assume(earliestExercise > block.timestamp && earliestExercise < expiry - 1 days);
        vm.assume(exerciseAmount > 0 && exerciseAmount <= notional);
        vm.assume(exerciseTime >= block.timestamp && exerciseTime < earliestExercise);

        // Initialize the RFQ match
        address optionReceiver = address(0x6);
        DataTypes.RFQInitialization memory rfqInit = DataTypes.RFQInitialization({
            optionInfo: DataTypes.OptionInfo({
                underlyingToken: UNDERLYING_TOKEN,
                settlementToken: SETTLEMENT_TOKEN,
                notional: notional,
                strike: strike,
                expiry: expiry,
                earliestExercise: earliestExercise,
                advancedEscrowSettings: DataTypes.AdvancedEscrowSettings({
                    borrowingAllowed: true,
                    votingDelegationAllowed: true,
                    allowedDelegateRegistry: address(0)
                })
            })
        });

        escrow.initializeRFQMatch(ROUTER, OWNER, optionReceiver, rfqInit);

        address exerciser = address(0x9);
        address underlyingReceiver = address(0x10);

        // Mint option tokens to the exerciser
        vm.prank(optionReceiver);
        escrow.transfer(exerciser, exerciseAmount);

        // Warp to the exercise time (before earliest exercise)
        vm.warp(exerciseTime);

        // Try to exercise before the earliest exercise time
        vm.prank(ROUTER);
        vm.expectRevert();
        escrow.handleCallExercise(exerciser, underlyingReceiver, exerciseAmount);
    }
}