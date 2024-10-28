# MYSO V3

MYSO v3 is a protocol for creating bespoke on-chain covered calls, enabling users to earn upfront income by writing call options. This approach accommodates a wide range of users—from HNWIs and treasuries to asset managers—who wish to generate yield on various tokens with flexible customization options to support diverse use cases.

MYSO v3 offers two settlement methods for covered call match-making:

- Dutch Auction: This method allows users to sell upside on their token by initiating an auction with a high premium that gradually decreases over time until a trading firm bids to match. Settlement occurs immediately upon a successful bid.
- Request for Quote (RFQ): In this route, trading firms can submit off-chain offers in response to user requests via signed messages. Users can accept a quote and trigger settlement by initiating a take-quote transaction.

Upon a match, the option position is represented as an ERC20 option token, which is transferable and can be resold. The option writer gains ownership of an escrow account backing the option with the specified underlying asset. Depending on the given option configuration, various post-settlement use cases can be supported, such as allowing the owner to retain voting power over the collateral or enabling the option holder to borrow and repay underlying tokens.

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
