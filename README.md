# MYSO V3

MYSO v3 is a protocol for creating bespoke on-chain covered calls, enabling users to earn upfront income by writing call options. This approach accommodates a wide range of users—from HNWIs and treasuries to asset managers—who wish to generate yield on various tokens with flexible customization options to support diverse use cases.

MYSO v3 offers two settlement methods for covered call match-making:

- Dutch Auction: This method allows users to sell upside on their token by initiating an auction with a high premium that gradually decreases over time until a trading firm bids to match. Settlement occurs immediately upon a successful bid.
- Request for Quote (RFQ): In this route, trading firms can submit off-chain offers in response to user requests via signed messages. Users can accept a quote and trigger settlement by initiating a take-quote transaction.

Upon a match, the option position is represented as an ERC20 option token, which is transferable and can be resold. The option writer gains ownership of an escrow account backing the option with the specified underlying asset. Depending on the given option configuration, various post-settlement use cases can be supported, such as allowing the owner to retain voting power over the collateral or enabling the option holder to borrow and repay underlying tokens.

## Directory Structure

```
contracts/
┣ errors/
┃ ┗ Errors.sol                     # Defines error codes for revert messages
┣ feehandler/
┃ ┗ FeeHandler.sol                 # Handles fee management for Router actions
┣ interfaces/                      # Interfaces for modularity and testing
┃ ┣ IDelegation.sol
┃ ┣ IEIP1271.sol
┃ ┣ IEscrow.sol
┃ ┣ IOracle.sol
┃ ┗ IRouter.sol
┣ oracles/
┃ ┗ ChainlinkOracle.sol            # Integration with Chainlink Oracle for pricing
┣ test/                            # Mock contracts for testing functionality
┃ ┣ EIP1271Maker.sol
┃ ┣ MockDelegateRegistry.sol
┃ ┣ MockERC20.sol
┃ ┣ MockERC20Votes.sol
┃ ┣ MockHighFeeHandler.sol
┃ ┣ MockOracle.sol
┃ ┗ TestRecover.sol
┣ utils/
┃ ┗ InitializableERC20.sol         # Customizable ERC20 implementation for initializing tokens
┣ DataTypes.sol                    # Contains data structures and types for contracts
┣ Escrow.sol                       # Escrow contract for managing funds and collateral
┗ Router.sol                       # Core Router contract for auction and option operations
```

## Test structure

```
test/
┣ DataTypes.ts
┣ helpers.ts                       # Helper functions for setting up tests
┣ TestChainlinkOracle.ts           # Tests for ChainlinkOracle integration
┣ TestRouter.ts                    # Core tests for Router functionalities
┣ TestRouterWithEIP1271Maker.ts    # Tests with EIP1271 signature validation
┣ TestRouterWithEscrow.ts          # Tests Router with Escrow operations
┗ TestRouterWithFees.ts            # Tests fee management and distribution in Router
```

## Test Coverage

```
-----------------------|----------|----------|----------|----------|----------------|
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
-----------------------|----------|----------|----------|----------|----------------|
All files              |      100 |      100 |      100 |      100 |                |
-----------------------|----------|----------|----------|----------|----------------|
```

To run the tests, install the necessary dependencies using `npm -i` and then run `npx hardhat test`.
