export namespace DataTypes {
  export interface AuctionParams {
    relStrike: bigint;
    tenor: number;
    earliestExerciseTenor: number;
    relPremiumStart: bigint;
    relPremiumFloor: bigint;
    decayDuration: number;
    minSpot: bigint;
    maxSpot: bigint;
    decayStartTime: number;
  }

  export interface AdvancedSettings {
    borrowCap: bigint;
    oracle: string;
    premiumTokenIsUnderlying: boolean;
    votingDelegationAllowed: boolean;
    allowedDelegateRegistry: string;
  }

  export interface OptionInfo {
    underlyingToken: string;
    settlementToken: string;
    notional: bigint;
    strike: bigint;
    earliestExercise: number;
    expiry: number;
    advancedSettings: AdvancedSettings;
  }

  export interface RFQQuote {
    premium: bigint;
    validUntil: number;
    signature: string;
  }

  export interface RFQInitialization {
    optionInfo: OptionInfo;
    rfqQuote: RFQQuote;
  }

  export interface AuctionInitialization {
    underlyingToken: string;
    settlementToken: string;
    notional: bigint;
    auctionParams: AuctionParams;
    advancedSettings: AdvancedSettings;
  }

  export enum BidStatus {
    Success = 0,
    SpotPriceTooLow = 1,
    OutOfRangeSpotPrice = 2,
    OptionAlreadyMinted = 3,
    PremiumTooLow = 4,
    InsufficientFunding = 5,
    InvalidProtocolFees = 6,
  }

  export interface BidPreview {
    status: BidStatus;
    settlementToken: string;
    underlyingToken: string;
    strike: bigint;
    expiry: number;
    earliestExercise: number;
    premium: bigint;
    premiumToken: string;
    oracleSpotPrice: bigint;
    currAsk: bigint;
    matchFeeProtocol: bigint;
    matchFeeDistPartner: bigint;
  }

  export enum RFQStatus {
    Expired = 0,
    AlreadyExecuted = 1,
    InsufficientFunding = 2,
    QuotesPaused = 3,
    Success = 4,
  }

  export interface TakeQuotePreview {
    status: RFQStatus;
    msgHash: string;
    quoter: string;
    premium: bigint;
    premiumToken: string;
    matchFeeProtocol: bigint;
    matchFeeDistPartner: bigint;
  }

  export interface SwapQuote {
    takerGiveToken: string;
    takerGiveAmount: bigint;
    makerGiveToken: string;
    makerGiveAmount: bigint;
    validUntil: number;
    signature: string;
  }
}
