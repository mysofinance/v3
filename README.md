# MYSO V3

MYSO v3 is a protocol designed to efficiently match HNWIs, treasuries, and asset managers with institutional trading firms for writing call options ("covered calls"). A covered call is an option writing strategy that allows users to capitalize on token positions and receive instant income ("option premium") in exchange for capping upside in a token ("underlying") over a given time interval ("tenor") by committing to a conversion price ("strike") at which institutional trading firms have the right—but not the obligation—to acquire tokens from the user. The protocol provides users with full flexibility to utilize various underlying tokens and define bespoke option parameters. In addition to covered calls, the protocol supports several related use cases, such as put writing and standalone option minting for example for protocol incentive distributions.

For match-making, MYSO v3 offers users the choice between two matching routes:

- Dutch Auction: This method allows users to sell upside on their tokens by initiating a Dutch auction. The process begins with the call option being offered at a high relative premium (i.e., relative to the notional value), which then gradually decreases over time. Market participants can monitor the auction and place bids when the premium meets their target value. Since option terms such as strike and premium are quoted in relative terms, this matchmaking route can be particularly useful for DAO treasuries, where it may be infeasible to quote an option in absolute terms due to the time required for DAO voting. Note that Dutch auctions require on-chain oracles.
- Request for Quote (RFQ): In this route, users can request quotes for various option configurations from institutional trading firms. Trading firms can respond to those requests and make offers using off-chain signatures. Users can accept a quote by submitting the received signature on-chain for settlement. Unlike the Dutch auction route, in the RFQ route, option terms are quoted in absolute values (i.e., absolute strike and premium), which allows for matchmaking independently of on-chain oracles. The protocol is agnostic to whether the RFQ process is facilitated manually or automatically.

Upon a match, the underlying token is locked in a segregated escrow account, to which only the option writer has access. The trading firm with whom the user is matched receives an ERC20 token representing the option position, giving the option token holder the right—but not the obligation—to acquire the underlying tokens at the specified strike price. MYSO v3 also features a simple atomic swap mechanism, allowing minted option tokens to be traded in a secondary market. This enables various use cases, such as unwinding a trade or executing back-to-back hedges. Depending on the option configuration, various post-settlement scenarios can be supported, such as allowing the option writer to retain voting power over the underlying tokens or enabling the option holder to borrow (and repay) underlying tokens for hedging purposes.

## Getting Started

### Prerequisites

- Node.js >= 22
- pnpm (the exact version is pinned via the `packageManager` field in `package.json`)

### Install Dependencies

```bash
pnpm install
```

### Environment Variables

The `.env.example` file lists the required environment variables (RPC URLs, API keys, deployer private keys). For deployment and verification workflows, these must be configured before use.

Sensitive values such as deployer private keys and API keys should be stored using Hardhat's encrypted keystore and never in a plain-text `.env` file.

Example of setting a deployer private key in the Hardhat keystore:

```bash
npx hardhat keystore set MAINNET_DEPLOYER_KEY
```

### Deployment

Deployment scripts are located in the `scripts/` directory.

Example of running script:

```bash
npx hardhat run scripts/deployCore.ts --network sepolia
```

### Run Tests

```bash
pnpm test
```
