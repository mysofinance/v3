const { expect } = require("chai");
import { ethers } from "hardhat";

import { keccak256, toUtf8Bytes } from "ethers";

// Replace with likely custom error names used in your contracts
const errorNames = [
  "DistPartnerFeeUnchanged()",
  "FeeHandlerAlreadySet()",
  "InvalidAddress()",
  "InvalidArrayLength()",
  "InvalidBid()",
  "InvalidBorrowAmount()",
  "InvalidBorrowCap()",
  "InvalidBorrowTime()",
  "InvalidDistPartnerFeeShare()",
  "InvalidEarliestExercise()",
  "InvalidEarliestExerciseTenor()",
  "InvalidEIP1271Signature()",
  "InvalidExpiry()",
  "InvalidExercise()",
  "InvalidExerciseAmount()",
  "InvalidExerciseFee()",
  "InvalidExerciseTime()",
  "InvalidGetEscrowsQuery()",
  "InvalidMatchFee()",
  "InvalidMaxTimeSinceLastUpdate()",
  "InvalidMintFee()",
  "InvalidMinMaxSpot()",
  "InvalidNotional()",
  "InvalidOracle()",
  "InvalidOracleAnswer()",
  "InvalidOracleDecimals()",
  "InvalidRelPremiums()",
  "InvalidRepayAmount()",
  "InvalidRepayTime()",
  "InvalidSender()",
  "InvalidStrike()",
  "InvalidTakeQuote()",
  "InvalidTenor()",
  "InvalidTokenPair()",
  "InvalidWithdraw()",
  "NoAllowedDelegateRegistry()",
  "NoOptionMinted()",
  "NoOracle()",
  "NotAnEscrow()",
  "NothingToRedeem()",
  "NothingToRepay()",
  "OnlyAvailableForAuctions()",
  "OracleAlreadySet(address oracleAddr)",
  "OwnerAlreadySet()",
  "SwapQuoteAlreadyUsed()",
  "SwapQuoteExpired()",
  "SwapQuotePaused()",
  "VotingDelegationNotAllowed()",
];

for (const name of errorNames) {
  const sig = keccak256(toUtf8Bytes(name)).substring(0, 10);
  console.log(`${name} => ${sig}`);
}

function toDateTimeString(timestamp: bigint | number) {
  const date = new Date(Number(timestamp) * 1000);
  return date.toISOString();
}

describe("Simulate", function () {
  it("checks forked block", async () => {
    const block = await ethers.provider.getBlockNumber();
    console.log("Forked block:", block);
  });

  it("should simulate exercise on a real escrow contract via mainnet fork", async function () {
    const MYSO_ROUTER_ADDRESS = "0x70B4B4991B21AC596CB9bC416B21f4B848E24ac5";
    const ESCROW_ADDRESS = "0x05eF786501696BDA7642a8398fC65a6d9dB16459";
    const FORKED_SIGNER_USER = "0x6ef5C4c1959478213ACFb1bb18deb43bAA703807";
    const FORKED_SIGNER_TRADING_FIRM =
      "0x2E06788C4Df0C7B926A85917c8c1659170861240";

    await ethers.provider.send("hardhat_impersonateAccount", [
      FORKED_SIGNER_TRADING_FIRM,
    ]);
    const impersonatedTradingFirm = await ethers.getSigner(
      FORKED_SIGNER_TRADING_FIRM
    );

    await ethers.provider.send("hardhat_impersonateAccount", [
      FORKED_SIGNER_USER,
    ]);
    const impersonatedUser = await ethers.getSigner(FORKED_SIGNER_USER);

    const router = await ethers.getContractAt("Router", MYSO_ROUTER_ADDRESS);
    const escrow = await ethers.getContractAt("Escrow", ESCROW_ADDRESS);

    const owner = await escrow.owner();
    const optionInfo = await escrow.optionInfo();
    const underlyingTokenAddr = optionInfo.underlyingToken;
    const settlementTokenAddr = optionInfo.settlementToken;

    const optionToken = await ethers.getContractAt("MockERC20", ESCROW_ADDRESS);
    const underlyingToken = await ethers.getContractAt(
      "MockERC20",
      underlyingTokenAddr
    );
    const settlementToken = await ethers.getContractAt(
      "MockERC20",
      settlementTokenAddr
    );

    const [underlyingTokenSymbol, underlyingTokenDecimals] = await Promise.all([
      underlyingToken.symbol(),
      underlyingToken.decimals(),
    ]);
    const [settlementTokenSymbol, settlementTokenDecimals] = await Promise.all([
      settlementToken.symbol(),
      settlementToken.decimals(),
    ]);

    const notional = optionInfo.notional;
    const strike = optionInfo.strike;
    const expiry = optionInfo.expiry;
    const earliestExercise = optionInfo.earliestExercise;

    const [optionTokenSymbol, optionTokenDecimals, totalSupply] =
      await Promise.all([
        optionToken.symbol(),
        optionToken.decimals(),
        optionToken.totalSupply(),
      ]);

    // Print all variables
    console.log("\n--- Escrow Info ---");
    console.log("Owner:", owner);
    console.log("Underlying Token:", underlyingTokenAddr);
    console.log("  Symbol:", underlyingTokenSymbol);
    console.log("  Decimals:", underlyingTokenDecimals);
    console.log("Settlement Token:", settlementTokenAddr);
    console.log("  Symbol:", settlementTokenSymbol);
    console.log("  Decimals:", settlementTokenDecimals);

    console.log("\n--- Option Info ---");
    console.log(
      "Notional:",
      notional.toString(),
      `(${ethers.formatUnits(notional, underlyingTokenDecimals)})`
    );
    console.log(
      "Strike:",
      strike.toString(),
      `(${ethers.formatUnits(strike, settlementTokenDecimals)})`
    );
    console.log("Expiry:", expiry.toString(), `(${toDateTimeString(expiry)})`);
    console.log(
      "Earliest Exercise:",
      earliestExercise.toString(),
      `(${toDateTimeString(earliestExercise)})`
    );

    console.log("\n--- Option Token Info ---");
    console.log("Symbol:", optionTokenSymbol);
    console.log("Decimals:", optionTokenDecimals);
    console.log("Total Supply:", totalSupply.toString());

    // step 1: trading firm sends option tokens to user
    const optionTokenBalanceTradingFirm = await optionToken.balanceOf(
      impersonatedTradingFirm.address
    );
    console.log(
      `Sending ${Number(ethers.formatUnits(optionTokenBalanceTradingFirm, optionTokenDecimals)).toLocaleString()} ${optionTokenSymbol} from ${impersonatedTradingFirm.address} to ${impersonatedUser.address}`
    );
    await optionToken
      .connect(impersonatedTradingFirm)
      .transfer(impersonatedUser.address, optionTokenBalanceTradingFirm);

    // step 2: user calls redeem
    console.log("\n--- Executing Exercise ---");
    const optionTokenBalanceUser = await optionToken.balanceOf(
      impersonatedUser.address
    );
    console.log(
      `Calling redeem with ${Number(ethers.formatUnits(optionTokenBalanceUser, optionTokenDecimals)).toLocaleString()} from address ${impersonatedUser.address}`
    );

    const preUnderlyingBalance = await underlyingToken.balanceOf(
      impersonatedUser.address
    );
    console.log("\n--- Redeem Arguments ---");
    console.log("To:       ", impersonatedUser.address);
    const tx = await escrow
      .connect(impersonatedUser)
      .redeem(impersonatedUser.address);
    const postUnderlyingBalance = await underlyingToken.balanceOf(
      impersonatedUser.address
    );

    await expect(tx).to.emit(escrow, "Redeem");

    const receipt = await tx.wait();

    const redeemEvent = receipt?.logs
      .map((log) => {
        try {
          return router.interface.parseLog(log as any);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "Redeem");
    if (redeemEvent) {
      const { args } = redeemEvent;
      console.log("\n--- Redeem Event Emitted ---");
      console.log("Caller (msg.sender):     ", args[0]);
      console.log("To:                  ", args[1]);
      console.log("Underlying Token:     ", args[2]);
      console.log("Balance:       ", args[3].toString());
    } else {
      console.warn("⚠️ Redeem event not found in logs.");
    }

    console.log(
      `Pre underlying balance:       ${Number(ethers.formatUnits(preUnderlyingBalance, underlyingTokenDecimals)).toLocaleString()} ${underlyingTokenSymbol}`
    );
    console.log(
      `Post underlying balance:       ${Number(ethers.formatUnits(postUnderlyingBalance, underlyingTokenDecimals)).toLocaleString()} ${underlyingTokenSymbol}`
    );

    console.log(
      `\n✅ Successfully simulated redeem on fork at escrow: ${ESCROW_ADDRESS}`
    );
  });
});
