// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import "../contracts/Router.sol";
import "../contracts/Escrow.sol";
import "../contracts/DataTypes.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract RouterTest is Test {
    Router router;
    Escrow escrowImpl;
    MockERC20 underlyingToken;
    MockERC20 settlementToken;
    address owner;
    address quoter;
    address taker;

    function setUp() public {
        owner = address(this);
        quoter = address(0x1234);
        taker = makeAddr("taker");
        
        // Deploy mock tokens
        underlyingToken = new MockERC20("Underlying", "UNDER");
        settlementToken = new MockERC20("Settlement", "SETTLE");
        
        // Deploy Escrow implementation
        escrowImpl = new Escrow();
        
        // Deploy Router
        router = new Router(address(escrowImpl));
        
        // Mint tokens to this contract and approve Router
        underlyingToken.mint(owner, 1000e18);
        underlyingToken.mint(taker, 1000e18);
        settlementToken.mint(quoter, 1000e18);
        underlyingToken.approve(address(router), type(uint256).max);
        vm.prank(quoter);
        settlementToken.approve(address(router), type(uint256).max);
        vm.prank(taker);
        underlyingToken.approve(address(router), type(uint256).max);
    }

    function testStartAuction(uint256 notional, uint256 relStrike) public {
        notional = bound(notional, 1e18, 1000e18);
        relStrike = bound(relStrike, 0.5e18, 2e18);

        DataTypes.AuctionInitialization memory auctionInit = DataTypes.AuctionInitialization({
            underlyingToken: address(underlyingToken),
            settlementToken: address(settlementToken),
            notional: notional,
            auctionParams: DataTypes.AuctionParams({
                relStrike: relStrike,
                tenor: 7 days,
                earliestExerciseTenor: 1 days,
                relPremiumStart: 0.1e18,
                relPremiumFloor: 0.05e18,
                decayDuration: 1 days,
                minSpot: 0.8e18,
                maxSpot: 1.2e18,
                decayStartTime: block.timestamp,
                oracle: address(0x5678)
            }),
            advancedEscrowSettings: DataTypes.AdvancedEscrowSettings({
                borrowingAllowed: true,
                votingDelegationAllowed: true,
                allowedDelegateRegistry: address(0)
            })
        });

        router.startAuction(owner, auctionInit);

        assertEq(router.numEscrows(), 1);
        address escrowAddr = router.escrows(0);
        assertTrue(router.isEscrow(escrowAddr));

        Escrow escrow = Escrow(escrowAddr);
        assertEq(escrow.router(), address(router));
        assertEq(escrow.owner(), owner);
        assertEq(underlyingToken.balanceOf(escrowAddr), notional);
    }

    function testTakeQuote(uint256 notional, uint256 strike, uint256 premium) public {
        notional = bound(notional, 1e18, 1000e18);
        strike = bound(strike, 0.5e18, 2e18);
        premium = bound(premium, 0.01e18, 0.5e18);

        uint256 expiry = block.timestamp + 7 days;
        uint256 earliestExercise = block.timestamp + 1 days;
        uint256 validUntil = expiry;

        DataTypes.OptionInfo memory optionInfo = DataTypes.OptionInfo({
            underlyingToken: address(underlyingToken),
            settlementToken: address(settlementToken),
            notional: notional,
            strike: strike,
            expiry: expiry,
            earliestExercise: earliestExercise,
            advancedEscrowSettings: DataTypes.AdvancedEscrowSettings({
                borrowingAllowed: true,
                votingDelegationAllowed: true,
                allowedDelegateRegistry: address(0)
            })
        });

        bytes32 messageHash = keccak256(abi.encode(
            block.chainid,
            optionInfo.underlyingToken,
            optionInfo.settlementToken,
            optionInfo.notional,
            optionInfo.strike,
            optionInfo.expiry,
            optionInfo.earliestExercise,
            premium,
            validUntil
        ));

        // Convert the messageHash to an Ethereum Signed Message Hash
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);


        // Set up a private key for the quoter
        uint256 quoterPrivateKey = vm.deriveKey("test test test test test test test test test test test junk", 0);
    
        address computedQuoter = vm.addr(quoterPrivateKey);
        
        // Update the quoter address if it's different from the computed one
        if (quoter != computedQuoter) {
            quoter = computedQuoter;
        }

        // Mint settlement tokens to the quoter
        uint256 mintAmount = premium + 1e18; // Mint a bit extra to ensure enough balance
        vm.startPrank(address(settlementToken));
        settlementToken.mint(quoter, mintAmount);
        vm.stopPrank();

        // Approve router to spend settlement tokens
        vm.prank(quoter);
        settlementToken.approve(address(router), type(uint256).max);

        // Sign the message as the quoter
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(quoterPrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        DataTypes.RFQInitialization memory rfqInit = DataTypes.RFQInitialization({
            optionInfo: optionInfo,
            rfqQuote: DataTypes.RFQQuote({
                premium: premium,
                validUntil: expiry,
                signature: signature
            })
        });

        uint256 quoterSettlementBalanceBefore = settlementToken.balanceOf(quoter);
        uint256 takerUnderlyingBalanceBefore = underlyingToken.balanceOf(taker);
        vm.prank(taker);
        router.takeQuote(owner, rfqInit);

        assertEq(router.numEscrows(), 1);
        address escrowAddr = router.escrows(0);
        assertTrue(router.isEscrow(escrowAddr));

        Escrow escrow = Escrow(escrowAddr);
        assertEq(escrow.router(), address(router));
        assertEq(escrow.owner(), owner);
        assertEq(underlyingToken.balanceOf(escrowAddr), notional);
        assertEq(settlementToken.balanceOf(quoter), quoterSettlementBalanceBefore - premium);
        assertEq(underlyingToken.balanceOf(taker), takerUnderlyingBalanceBefore - notional);
        assertEq(settlementToken.balanceOf(taker), premium);
    }

    function testBidOnAuction(uint256 notional, uint256 relStrike, uint256 relBid) public {
    notional = bound(notional, 1e18, 1000e18);
    relStrike = bound(relStrike, 0.5e18, 2e18);
    relBid = bound(relBid, 0.1e18, 0.2e18);

    // Set up addresses
    address auctionStarter = makeAddr("auctionStarter");
    address optionReceiver = makeAddr("optionReceiver");

    // Mint underlying tokens to the auction starter
    vm.startPrank(address(underlyingToken));
    underlyingToken.mint(auctionStarter, notional);
    vm.stopPrank();

    // Approve router to spend underlying tokens
    vm.prank(auctionStarter);
    underlyingToken.approve(address(router), notional);

    // Start an auction
    DataTypes.AuctionInitialization memory auctionInit = DataTypes.AuctionInitialization({
        underlyingToken: address(underlyingToken),
        settlementToken: address(settlementToken),
        notional: notional,
        auctionParams: DataTypes.AuctionParams({
            relStrike: relStrike,
            tenor: 7 days,
            earliestExerciseTenor: 1 days,
            relPremiumStart: 0.1e18,
            relPremiumFloor: 0.05e18,
            decayDuration: 1 days,
            minSpot: 0.8e18,
            maxSpot: 1.2e18,
            decayStartTime: block.timestamp,
            oracle: address(this)
        }),
        advancedEscrowSettings: DataTypes.AdvancedEscrowSettings({
            borrowingAllowed: true,
            votingDelegationAllowed: true,
            allowedDelegateRegistry: address(0)
        })
    });

    vm.prank(auctionStarter);
    router.startAuction(auctionStarter, auctionInit);
    address escrowAddr = router.escrows(0);

    // Prepare for bidding
    uint256 refSpot = 1e18; // Assuming 1:1 exchange rate for simplicity
    uint256 premium = (relBid * notional * refSpot) / 1e18 / 1e18;

    // Mint settlement tokens to the bidder (optionReceiver)
    vm.startPrank(address(settlementToken));
    settlementToken.mint(optionReceiver, premium * 2); // Mint extra to ensure enough balance
    vm.stopPrank();

    // Approve router to spend settlement tokens
    vm.prank(optionReceiver);
    settlementToken.approve(address(router), premium * 2);

    // Record balances before bidding
    uint256 starterUnderlyingBalanceBefore = underlyingToken.balanceOf(auctionStarter);
    uint256 receiverSettlementBalanceBefore = settlementToken.balanceOf(optionReceiver);
    uint256 escrowUnderlyingBalanceBefore = underlyingToken.balanceOf(escrowAddr);

    // Now bid on the auction
    vm.prank(optionReceiver);
    router.bidOnAuction(escrowAddr, optionReceiver, relBid, notional, refSpot, new bytes[](0));

    // Verify token movements and contract state
    Escrow escrow = Escrow(escrowAddr);
    assertTrue(escrow.optionMinted());
    assertEq(escrow.balanceOf(optionReceiver), notional);
    assertEq(underlyingToken.balanceOf(escrowAddr), escrowUnderlyingBalanceBefore);
    assertEq(settlementToken.balanceOf(optionReceiver), receiverSettlementBalanceBefore - premium);
    assertEq(settlementToken.balanceOf(auctionStarter), premium);
    assertEq(underlyingToken.balanceOf(auctionStarter), starterUnderlyingBalanceBefore);
}

    // Mock oracle function for testing
    function getPrice(address, address, uint256 refSpot, bytes[] memory) external pure returns (uint256) {
        return refSpot;
    }
}