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

contract EscrowTest is Test {
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

    function testInitializeAuction() public {
        DataTypes.AuctionInitialization memory auctionInit = DataTypes.AuctionInitialization({
            underlyingToken: UNDERLYING_TOKEN,
            settlementToken: SETTLEMENT_TOKEN,
            notional: 1000 ether,
            advancedEscrowSettings: DataTypes.AdvancedEscrowSettings({
                borrowingAllowed: true,
                votingDelegationAllowed: true,
                allowedDelegateRegistry: address(0)
            }),
            auctionParams: DataTypes.AuctionParams({
                relStrike: 1.1e18,
                tenor: 7 days,
                earliestExerciseTenor: 1 days,
                relPremiumStart: 0.1e18,
                relPremiumFloor: 0.05e18,
                decayStartTime: block.timestamp + 1 hours,
                decayDuration: 6 hours,
                minSpot: 900e18,
                maxSpot: 1100e18,
                oracle: ORACLE
            })
        });

        escrow.initializeAuction(ROUTER, OWNER, auctionInit);

        assertTrue(escrow.isAuction());
        assertEq(escrow.router(), ROUTER);
        assertEq(escrow.owner(), OWNER);
    }

    function testHandleAuctionBid() public {
        // Setup
        testInitializeAuction();

        // Mock oracle call
        vm.mockCall(
            ORACLE,
            abi.encodeWithSelector(IOracle.getPrice.selector),
            abi.encode(1000e18)
        );

        // Prepare bid data
        uint256 relBid = 0.08e18;
        uint256 amount = 1000 ether;
        address optionReceiver = address(0x6);
        uint256 refSpot = 1000e18;
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
        assertEq(strike, 1100e18);
        assertTrue(expiry > block.timestamp);
        assertTrue(earliestExercise > block.timestamp);
        assertEq(premium, 80 ether);
        assertEq(oracleSpotPrice, 1000e18);
    }

    function testInitializeRFQMatchAndHandleBorrow() public {
    address optionReceiver = address(0x6);
    DataTypes.RFQInitialization memory rfqInit = DataTypes.RFQInitialization({
        optionInfo: DataTypes.OptionInfo({
            underlyingToken: UNDERLYING_TOKEN,
            settlementToken: SETTLEMENT_TOKEN,
            notional: 1000 ether,
            strike: 1100e18,
            expiry: block.timestamp + 7 days,
            earliestExercise: block.timestamp + 1 days,
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
    assertEq(escrow.balanceOf(optionReceiver), 1000 ether);

    // Test handleBorrow
    address borrower = address(0x7);
    address underlyingReceiver = address(0x8);
    uint256 underlyingAmount = 500 ether;

    // Mock the underlying token transfer
    vm.mockCall(
        UNDERLYING_TOKEN,
        abi.encodeWithSelector(IERC20.transfer.selector, underlyingReceiver, underlyingAmount),
        abi.encode(true)
    );

    vm.prank(ROUTER);
    (address settlementToken, uint256 collateralAmount) = escrow.handleBorrow(borrower, underlyingReceiver, underlyingAmount);

    assertEq(settlementToken, SETTLEMENT_TOKEN);
    assertEq(collateralAmount, 550 ether); // (1100e18 * 500 ether) / 1000 ether
    assertEq(escrow.borrowedUnderlyingAmounts(borrower), 500 ether);
    assertEq(escrow.balanceOf(borrower), 500 ether);
}

    function testHandleCallExercise() public {
    // First, initialize the RFQ match
    testInitializeRFQMatchAndHandleBorrow();

    address exerciser = address(0x9);
    address underlyingReceiver = address(0x10);
    uint256 underlyingAmount = 750 ether;

    // Instead of minting directly, we transfer tokens from the option receiver
    address optionReceiver = address(0x6);
    vm.prank(optionReceiver);
    escrow.transfer(exerciser, underlyingAmount);

    // Mock the underlying token transfer
    vm.mockCall(
        UNDERLYING_TOKEN,
        abi.encodeWithSelector(IERC20.transfer.selector, underlyingReceiver, underlyingAmount),
        abi.encode(true)
    );

    vm.prank(ROUTER);
    (address settlementToken, uint256 settlementAmount) = escrow.handleCallExercise(exerciser, underlyingReceiver, underlyingAmount);

    assertEq(settlementToken, SETTLEMENT_TOKEN);
    assertEq(settlementAmount, 825 ether); // (1100e18 * 750 ether) / 1000 ether
    assertEq(escrow.balanceOf(exerciser), 0);
}

    function testHandleCallExerciseFailsBeforeEarliestExercise() public {
    // Initialize the RFQ match
    testInitializeRFQMatchAndHandleBorrow();

    address exerciser = address(0x9);
    address underlyingReceiver = address(0x10);
    uint256 underlyingAmount = 750 ether;

    // Instead of minting directly, we transfer tokens from the option receiver
    address optionReceiver = address(0x6);
    vm.prank(optionReceiver);
    escrow.transfer(exerciser, underlyingAmount);

    // Try to exercise before the earliest exercise time
    vm.prank(ROUTER);
    vm.expectRevert();
    escrow.handleCallExercise(exerciser, underlyingReceiver, underlyingAmount);
}

    function testHandleCallExerciseFailsAfterExpiry() public {
    // Initialize the RFQ match
    testInitializeRFQMatchAndHandleBorrow();

    address exerciser = address(0x9);
    address underlyingReceiver = address(0x10);
    uint256 underlyingAmount = 750 ether;

    // Instead of minting directly, we transfer tokens from the option receiver
    address optionReceiver = address(0x6);
    vm.prank(optionReceiver);
    escrow.transfer(exerciser, underlyingAmount);

    // Move time past the expiry
    vm.warp(block.timestamp + 8 days);

    // Try to exercise after expiry
    vm.prank(ROUTER);
    vm.expectRevert();
    escrow.handleCallExercise(exerciser, underlyingReceiver, underlyingAmount);
}
}