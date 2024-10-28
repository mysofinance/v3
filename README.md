# MYSO V3

MYSO v3 is a protocol designed to efficiently match HNWIs, treasuries, and asset managers with institutional trading firms for writing call options ("covered calls"). Covered calls are an option writing strategy that allows users to capitalize on token positions by receiving instant income ("option premium") in exchange for capping upside in a token ("underlying") over a given time interval ("tenor") by committing to a conversion price ("strike") at which institutional trading firms have the right—but not the obligation—to acquire tokens from the user. The protocol provides users with full flexibility to utilize various underlying tokens and define custom option parameters. In addition to covered calls, the protocol supports other use cases, such as put writing as well as standalone option minting for protocol incentive distributions.

For match-making, MYSO v3 offers users the choice between two matching routes:

- Dutch Auction: This method allows users to sell upside on their tokens by initiating a Dutch auction. The process begins with the call option being offered at a high relative premium (i.e., relative to the notional value), which then gradually decreases over time. Market participants can monitor the auction and place bids when the premium meets their target value. Since option terms such as strike and premium are quoted in relative terms, this matchmaking route can be particularly useful for DAO treasuries, where it may be infeasible to quote an option in absolute terms due to the time required for DAO voting. Note that Dutch auctions require on-chain oracles to function.
- Request for Quote (RFQ): In this route, users can request quotes for various option configurations from institutional trading firms, who can respond and make offers using off-chain signatures. Users can accept a quote by submitting the received signature on-chain for settlement. Unlike the Dutch auction route, for the RFQ option terms are quoted in absolute values (i.e., absolute strike and premium), which allows for match-making independently of on-chain oracles. Note that the protocol is agnostic to whether the RFQ process is facilitated manually or automatically.

Upon a match, the underlying token is locked in a segregated escrow account, to which only the option writer has access. The trading firm with whom the user is matched receives an ERC20 token representing the option position, giving the option token holder the right—but not the obligation—to acquire the underlying tokens at the specified strike price. MYSO v3 also features a simple atomic swap mechanism, allowing minted option tokens to be traded in a secondary market. This enables various use cases, such as unwinding a trade or executing back-to-back hedges. Depending on the option configuration, various post-settlement scenarios can be supported, such as allowing the option writer to retain voting power over the underlying tokens or enabling the option holder to borrow (and repay) underlying tokens for hedging purposes.

## Contracts

```
contracts/
┣ errors/
┃ ┗ Errors.sol
┣ feehandler/
┃ ┗ FeeHandler.sol
┣ interfaces/
┃ ┣ IDelegation.sol
┃ ┣ IEIP1271.sol
┃ ┣ IEscrow.sol
┃ ┣ IFeeHandler.sol
┃ ┣ IOracleAdapter.sol
┃ ┗ IRouter.sol
┣ oracles/
┃ ┗ OracleAdapter.sol
┣ test/
┃ ┣ EIP1271Maker.sol
┃ ┣ MockAggregatorV3.sol
┃ ┣ MockDelegateRegistry.sol
┃ ┣ MockERC20.sol
┃ ┣ MockERC20Votes.sol
┃ ┣ MockHighFeeHandler.sol
┃ ┣ MockOracle.sol
┃ ┗ TestRecover.sol
┣ utils/
┃ ┗ InitializableERC20.sol
┣ DataTypes.sol
┣ Escrow.sol
┗ Router.sol
```

## Test Files

```
test/
┣ DataTypes.ts
┣ helpers.ts
┣ TestOracleAdapter.ts
┣ TestRouter.ts
┣ TestRouterWithEIP1271Maker.ts
┣ TestRouterWithEscrow.ts
┗ TestRouterWithFees.ts
```

## Test Coverage

```
-----------------------|----------|----------|----------|----------|----------------|
File                   |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
-----------------------|----------|----------|----------|----------|----------------|
 contracts\            |      100 |      100 |      100 |      100 |                |
  Escrow.sol           |      100 |      100 |      100 |      100 |                |
  Router.sol           |      100 |      100 |      100 |      100 |                |
 contracts\errors\     |      100 |      100 |      100 |      100 |                |
  Errors.sol           |      100 |      100 |      100 |      100 |                |
 contracts\feehandler\ |      100 |      100 |      100 |      100 |                |
  FeeHandler.sol       |      100 |      100 |      100 |      100 |                |
 contracts\oracles\    |      100 |      100 |      100 |      100 |                |
  OracleAdapter.sol    |      100 |      100 |      100 |      100 |                |
-----------------------|----------|----------|----------|----------|----------------|
All files              |      100 |      100 |      100 |      100 |                |
-----------------------|----------|----------|----------|----------|----------------|
```

To run the tests, install the necessary dependencies using `npm -i` and then run `npx hardhat test`.
