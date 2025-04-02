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
    const ESCROW_ADDRESS = "0x38b672fcedb40617fbafabf4eff1a8cf838183e9";
    const FORKED_SIGNER = "0xee0922a6b0768e32fa66a8aa51e8c0f085a2ed4c";
    const RECEIVER = FORKED_SIGNER;
    // NOTE: exercise amount is in underlying token (eg for put USDC)
    const EXERCISE_AMOUNT = 30_000n * 10n ** 6n; // 30k USDC
    const PAY_IN_SETTLEMENT_TOKEN = true;
    const ORACLE_DATA = [] as any;

    await ethers.provider.send("hardhat_impersonateAccount", [FORKED_SIGNER]);
    const impersonatedSigner = await ethers.getSigner(FORKED_SIGNER);

    const router = await ethers.getContractAt(
      "Router",
      MYSO_ROUTER_ADDRESS,
      impersonatedSigner
    );
    const escrow = await ethers.getContractAt(
      "Escrow",
      ESCROW_ADDRESS,
      impersonatedSigner
    );

    const owner = await escrow.owner();
    const optionInfo = await escrow.optionInfo();
    const underlyingTokenAddr = optionInfo.underlyingToken;
    const settlementTokenAddr = optionInfo.settlementToken;

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
    const [
      settlementTokenSymbol,
      settlementTokenDecimals,
      settlementTokenAllowance,
    ] = await Promise.all([
      settlementToken.symbol(),
      settlementToken.decimals(),
      settlementToken.allowance(FORKED_SIGNER, MYSO_ROUTER_ADDRESS),
    ]);

    const notional = optionInfo.notional;
    const strike = optionInfo.strike;
    const expiry = optionInfo.expiry;
    const earliestExercise = optionInfo.earliestExercise;

    const optionToken = await ethers.getContractAt("MockERC20", escrow);
    const [optionTokenSymbol, optionTokenDecimals, totalSupply] =
      await Promise.all([
        optionToken.symbol(),
        optionToken.decimals(),
        optionToken.totalSupply(),
      ]);

    const optionTokenBalance = await optionToken.balanceOf(FORKED_SIGNER);

    // Print all variables
    console.log("\n--- Escrow Info ---");
    console.log("Owner:", owner);
    console.log("Underlying Token:", underlyingTokenAddr);
    console.log("  Symbol:", underlyingTokenSymbol);
    console.log("  Decimals:", underlyingTokenDecimals);
    console.log("Settlement Token:", settlementTokenAddr);
    console.log("  Symbol:", settlementTokenSymbol);
    console.log("  Decimals:", settlementTokenDecimals);
    console.log("  Allowance for Router:", settlementTokenAllowance.toString());

    console.log("\n--- Option Info ---");
    console.log("Notional:", notional.toString());
    console.log("Strike:", strike.toString());
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

    console.log("\n--- Signer Holdings ---");
    console.log(
      `Option Token Balance of ${FORKED_SIGNER}:`,
      optionTokenBalance.toString()
    );

    console.log("\n--- Exercise Arguments ---");
    console.log("Escrow Address:       ", ESCROW_ADDRESS);
    console.log("Receiver:             ", RECEIVER);
    console.log("Exercise Amount:      ", EXERCISE_AMOUNT.toString());
    console.log("Pay in Settlement:    ", PAY_IN_SETTLEMENT_TOKEN);
    console.log("Oracle Data (length): ", ORACLE_DATA.length);

    console.log("\n--- Executing Exercise ---");
    const preUnderlyingBalance = await underlyingToken.balanceOf(FORKED_SIGNER);
    const preSettlementBalance = await settlementToken.balanceOf(FORKED_SIGNER);
    const tx = await router
      .connect(impersonatedSigner)
      .exercise(
        ESCROW_ADDRESS,
        RECEIVER,
        EXERCISE_AMOUNT,
        PAY_IN_SETTLEMENT_TOKEN,
        ORACLE_DATA
      );

    await expect(tx).to.emit(router, "Exercise");
    const postUnderlyingBalance =
      await underlyingToken.balanceOf(FORKED_SIGNER);
    const postSettlementBalance =
      await settlementToken.balanceOf(FORKED_SIGNER);

    console.log("\n--- Signer Balances Before & After ---");
    console.log(`Underlying Token (${underlyingTokenSymbol})`);
    console.log("  Before:", preUnderlyingBalance.toString());
    console.log("  After: ", postUnderlyingBalance.toString());
    console.log(
      "  Δ      :",
      (postUnderlyingBalance - preUnderlyingBalance).toString()
    );

    console.log(`\nSettlement Token (${settlementTokenSymbol})`);
    console.log("  Before:", preSettlementBalance.toString());
    console.log("  After: ", postSettlementBalance.toString());
    console.log(
      "  Δ      :",
      (postSettlementBalance - preSettlementBalance).toString()
    );

    const receipt = await tx.wait();

    const exerciseEvent = receipt?.logs
      .map((log) => {
        try {
          return router.interface.parseLog(log as any);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "Exercise");

    if (exerciseEvent) {
      const { args } = exerciseEvent;
      console.log("\n--- Exercise Event Emitted ---");
      console.log("Caller (msg.sender):     ", args[0]);
      console.log("Escrow:                  ", args[1]);
      console.log("Underlying Receiver:     ", args[2]);
      console.log("Underlying Amount:       ", args[3].toString());
      console.log("Exercise Fee Amount:     ", args[4].toString());
    } else {
      console.warn("⚠️ Exercise event not found in logs.");
    }

    console.log(
      `\n✅ Successfully simulated exercise on fork at escrow: ${ESCROW_ADDRESS}`
    );
  });
});
