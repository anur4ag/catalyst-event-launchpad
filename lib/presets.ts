// DBC launch presets. Each preset is a pure function -> DBC ConfigParameters.
// Static presets are published once as shared on-chain configs (the author is feeClaimer
// and earns partner fees + pool creation fee on every launch). Event-Horizon is built per
// launch because its locks are keyed to the linked event's resolution time.
import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithLiquidityWeights,
  CollectFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  MAX_LOCK_DURATION_IN_SECONDS,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  type BuildCurveWithLiquidityWeightsParams,
  type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export type PresetId = "event-horizon" | "flat" | "long" | "parabolic";

export type PresetOptions = {
  /** Multiplies every market cap (in SOL). 1 = production scale, ~0.01 for devnet demos. */
  scale?: number;
  /** Pool creation fee in SOL paid to the preset author (feeClaimer). */
  creationFeeSol?: number;
  /** Event-Horizon only: unix seconds when the linked event resolves. */
  resolutionTime?: number;
  /** Event-Horizon only: unix seconds "now" (injectable for tests). */
  now?: number;
};

export type Preset = {
  id: PresetId;
  name: string;
  tagline: string;
  eventLinked: boolean;
  /** Plain-language summary of the config, shown in the marketplace. */
  facts: string[];
  /** Market caps in SOL at scale 1. */
  initialMcap: number;
  migrationMcap: number;
  build(opts?: PresetOptions): ConfigParameters;
};

const SUPPLY = 1_000_000_000;
const DAY = 86_400;
const CREATOR_VESTING_SHARE = 0.1; // 10% of supply vests to the creator after the event
const VEST_AFTER_CLIFF = 30 * DAY;

const TOKEN = {
  tokenType: TokenType.SPLToken,
  tokenBaseDecimal: TokenDecimal.SIX,
  tokenQuoteDecimal: TokenDecimal.NINE, // SOL quote
  tokenAuthorityOption: TokenAuthorityOption.Immutable,
  totalTokenSupply: SUPPLY,
  leftover: 1_000, // rounding buffer the builder requires; withdrawable by leftoverReceiver
};

const NO_VESTING = {
  totalLockedVestingAmount: 0,
  numberOfVestingPeriod: 0,
  cliffUnlockAmount: 0,
  totalVestingDuration: 0,
  cliffDurationFromMigrationTime: 0,
};

/** 16 geometric weights: ratio > 1 deepens liquidity toward graduation, < 1 thins it (price accelerates). */
export const geometricWeights = (ratio: number) => Array.from({ length: 16 }, (_, i) => ratio ** i);

/** Seconds from now until the event's scheduled resolution, clamped so cliff + vesting fits DBC's 2-year lock cap.
 * DBC counts the cliff from graduation, which comes after launch, so unlocking starts on or after that date. */
export function cliffUntilResolution(resolutionTime: number, now: number, vestAfterCliff = VEST_AFTER_CLIFF) {
  return Math.max(0, Math.min(resolutionTime - now, MAX_LOCK_DURATION_IN_SECONDS - vestAfterCliff));
}

type Shape = Omit<BuildCurveWithLiquidityWeightsParams, "token" | "activationType" | "initialMarketCap" | "migrationMarketCap">;

function make(p: Omit<Preset, "build">, shape: (o: Required<Pick<PresetOptions, "now">> & PresetOptions) => Shape): Preset {
  return {
    ...p,
    build(opts = {}) {
      const scale = opts.scale ?? 1;
      const s = shape({ now: Math.floor(Date.now() / 1000), ...opts });
      const cfg = buildCurveWithLiquidityWeights({
        ...s,
        fee: { ...s.fee, poolCreationFee: opts.creationFeeSol ?? s.fee.poolCreationFee },
        token: TOKEN,
        activationType: ActivationType.Timestamp,
        initialMarketCap: p.initialMcap * scale,
        migrationMarketCap: p.migrationMcap * scale,
      });
      return cfg; // client.partner.createConfig re-validates everything before building the tx
    },
  };
}

export const PRESETS: Record<PresetId, Preset> = {
  "event-horizon": make(
    {
      id: "event-horizon",
      facts: [
        "Anti-sniper fee 50% → 1% over 15 min (exponential), plus a volatility fee",
        "Creator's 10% allocation stays locked past the event's scheduled resolution date, then vests over 30 days",
        "90% of LP vests to the creator on the same schedule; 10% is locked forever",
        "Lock lengths are set at launch and counted from graduation; they don't depend on the outcome",
        "Graduated pool fee falls 2% → 0.25% as market cap grows 10×",
      ],
      name: "Event Horizon",
      tagline: "The creator's allocation and LP stay locked past the linked event's resolution date.",
      eventLinked: true,
      initialMcap: 30,
      migrationMcap: 300,
    },
    ({ resolutionTime, now }) => {
      if (!resolutionTime) throw new Error("event-horizon needs resolutionTime");
      const cliff = cliffUntilResolution(resolutionTime, now);
      return {
        liquidityWeights: geometricWeights(1.25), // fast early discovery, deep near graduation
        fee: {
          baseFeeParams: {
            baseFeeMode: BaseFeeMode.FeeSchedulerExponential,
            feeSchedulerParam: { startingFeeBps: 5000, endingFeeBps: 100, numberOfPeriod: 30, totalDuration: 900 },
          },
          dynamicFeeEnabled: true, // news spikes pay a volatility fee
          collectFeeMode: CollectFeeMode.QuoteToken,
          creatorTradingFeePercentage: 50,
          poolCreationFee: 0.01,
          enableFirstSwapWithMinFee: true, // creator's first buy skips the anti-sniper fee
        },
        migration: {
          migrationOption: MigrationOption.MET_DAMM_V2,
          migrationFeeOption: MigrationFeeOption.Customizable,
          migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
          migratedPoolFee: {
            collectFeeMode: MigratedCollectFeeMode.QuoteToken,
            dynamicFee: DammV2DynamicFeeMode.Enabled,
            poolFeeBps: 200,
            baseFeeMode: DammV2BaseFeeMode.FeeMarketCapSchedulerExponential,
            // Fees fall as the graduated pool 10x's; the schedule settles at the event's resolution.
            marketCapFeeSchedulerParams: {
              endingBaseFeeBps: 25,
              numberOfPeriod: 10,
              priceMultiple: 10,
              schedulerExpirationDuration: Math.max(cliff, DAY),
            },
          },
        },
        liquidityDistribution: {
          partnerPermanentLockedLiquidityPercentage: 10,
          partnerLiquidityPercentage: 0,
          creatorPermanentLockedLiquidityPercentage: 0,
          creatorLiquidityPercentage: 0,
          creatorLiquidityVestingInfoParams: {
            vestingPercentage: 90, // its own bucket: all creator LP vests, same cliff as the allocation
            bpsPerPeriod: 1000,
            numberOfPeriods: 10,
            cliffDurationFromMigrationTime: cliff,
            totalDuration: VEST_AFTER_CLIFF,
          },
        },
        lockedVesting: {
          totalLockedVestingAmount: SUPPLY * CREATOR_VESTING_SHARE,
          numberOfVestingPeriod: 30,
          cliffUnlockAmount: 0,
          totalVestingDuration: VEST_AFTER_CLIFF,
          cliffDurationFromMigrationTime: cliff,
        },
      };
    },
  ),

  flat: make(
    {
      id: "flat",
      facts: [
        "Price moves only 1.5× across the whole curve: early and late buyers pay about the same",
        "Flat 1% fee, no anti-sniper ramp",
        "Graduates into a compounding DAMM v2 pool: half of LP fees are reinvested",
        "50% of LP locked forever, 50% to the creator",
      ],
      name: "Flat",
      tagline: "Near-constant price (1.5x start to graduation). Fair distribution; graduates into a compounding pool.",
      eventLinked: false,
      initialMcap: 50,
      migrationMcap: 75,
    },
    () => ({
      liquidityWeights: geometricWeights(1),
      fee: {
        baseFeeParams: {
          baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
          feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
        },
        dynamicFeeEnabled: false,
        collectFeeMode: CollectFeeMode.QuoteToken,
        creatorTradingFeePercentage: 50,
        poolCreationFee: 0.01,
        enableFirstSwapWithMinFee: false,
      },
      migration: {
        migrationOption: MigrationOption.MET_DAMM_V2,
        migrationFeeOption: MigrationFeeOption.Customizable,
        migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
        migratedPoolFee: {
          collectFeeMode: MigratedCollectFeeMode.Compounding,
          compoundingFeeBps: 5000, // half of LP fees deepen the pool automatically
          dynamicFee: DammV2DynamicFeeMode.Disabled,
          poolFeeBps: 100,
        },
      },
      liquidityDistribution: {
        partnerPermanentLockedLiquidityPercentage: 50,
        partnerLiquidityPercentage: 0,
        creatorPermanentLockedLiquidityPercentage: 0,
        creatorLiquidityPercentage: 50,
      },
      lockedVesting: NO_VESTING,
    }),
  ),

  long: make(
    {
      id: "long",
      facts: [
        "1000× from first buy to graduation with even depth: a long runway",
        "Fee tapers 20% → 1% over the first hour, plus a volatility fee",
        "50% of LP locked forever (20% author, 30% creator), 50% to the creator",
      ],
      name: "Long Curve",
      tagline: "1000x from start to graduation with even depth. Long runway; fees taper over an hour.",
      eventLinked: false,
      initialMcap: 5,
      migrationMcap: 5000,
    },
    () => ({
      liquidityWeights: geometricWeights(1),
      fee: {
        baseFeeParams: {
          baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
          feeSchedulerParam: { startingFeeBps: 2000, endingFeeBps: 100, numberOfPeriod: 60, totalDuration: 3600 },
        },
        dynamicFeeEnabled: true,
        collectFeeMode: CollectFeeMode.QuoteToken,
        creatorTradingFeePercentage: 50,
        poolCreationFee: 0.01,
        enableFirstSwapWithMinFee: false,
      },
      migration: {
        migrationOption: MigrationOption.MET_DAMM_V2,
        migrationFeeOption: MigrationFeeOption.Customizable,
        migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
        migratedPoolFee: {
          collectFeeMode: MigratedCollectFeeMode.QuoteToken,
          dynamicFee: DammV2DynamicFeeMode.Enabled,
          poolFeeBps: 100,
        },
      },
      liquidityDistribution: {
        partnerPermanentLockedLiquidityPercentage: 20,
        partnerLiquidityPercentage: 0,
        creatorPermanentLockedLiquidityPercentage: 30,
        creatorLiquidityPercentage: 50,
      },
      lockedVesting: NO_VESTING,
    }),
  ),

  parabolic: make(
    {
      id: "parabolic",
      facts: [
        "Liquidity thins 20% per segment, so each SOL moves price more than the last",
        "Fee 30% → 1.5% over 10 min (exponential), plus a volatility fee",
        "All LP locked forever after graduation",
      ],
      name: "Parabolic",
      tagline: "Liquidity thins as price rises, so the curve accelerates into graduation.",
      eventLinked: false,
      initialMcap: 20,
      migrationMcap: 400,
    },
    () => ({
      liquidityWeights: geometricWeights(0.8),
      fee: {
        baseFeeParams: {
          baseFeeMode: BaseFeeMode.FeeSchedulerExponential,
          feeSchedulerParam: { startingFeeBps: 3000, endingFeeBps: 150, numberOfPeriod: 20, totalDuration: 600 },
        },
        dynamicFeeEnabled: true,
        collectFeeMode: CollectFeeMode.QuoteToken,
        creatorTradingFeePercentage: 50,
        poolCreationFee: 0.01,
        enableFirstSwapWithMinFee: false,
      },
      migration: {
        migrationOption: MigrationOption.MET_DAMM_V2,
        migrationFeeOption: MigrationFeeOption.Customizable,
        migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
        migratedPoolFee: {
          collectFeeMode: MigratedCollectFeeMode.QuoteToken,
          dynamicFee: DammV2DynamicFeeMode.Enabled,
          poolFeeBps: 150,
        },
      },
      liquidityDistribution: {
        partnerPermanentLockedLiquidityPercentage: 100,
        partnerLiquidityPercentage: 0,
        creatorPermanentLockedLiquidityPercentage: 0,
        creatorLiquidityPercentage: 0,
      },
      lockedVesting: NO_VESTING,
    }),
  ),
};
