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
}
