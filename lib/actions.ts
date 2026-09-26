// Every on-chain Catalyst action, as unsigned transactions + the throwaway signers they need.
// Shared by the web app (wallet signs) and scripts (keypairs sign), so the demo exercises the
// exact code the e2e script verifies.
import BN from "bn.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress,
  deriveDbcPoolAddress,
  DynamicBondingCurveClient,
  getCurrentPoint as dbcCurrentPoint,
  SwapMode,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, getCurrentPoint, getTokenProgram, SwapMode as DammSwapMode } from "@meteora-ag/cp-amm-sdk";
import { PRESETS, type PresetId } from "./presets";

export type Step = { label: string; tx: Transaction; signers: Keypair[] };

const U64_MAX = new BN("18446744073709551615");
const sol = (x: number) => new BN(Math.round(x * 1e9));

export const clients = (conn: Connection) => ({
  dbc: new DynamicBondingCurveClient(conn, "confirmed"),
  damm: new CpAmm(conn),
});

export type LaunchInput = {
  preset: PresetId;
  creator: PublicKey;
  /** Receives leftover tokens and makes the launch discoverable (see lib/launches.ts). */
  platform: PublicKey;
  /** Earns partner trading fees + pool creation fee. Defaults to platform. */
  author?: PublicKey;
  /** Shared on-chain config for static presets (from lib/deployments). Event-Horizon builds its own. */
  presetConfig?: PublicKey;
  resolutionTime?: number;
  scale?: number;
  name: string;
  symbol: string;
  uri: string;
  firstBuySol: number;
};

export async function launchSteps(conn: Connection, i: LaunchInput): Promise<{ steps: Step[]; pool: PublicKey; baseMint: PublicKey; config: PublicKey }> {
  const { dbc } = clients(conn);
  const baseMint = Keypair.generate();
  const firstBuy = i.firstBuySol > 0
    ? { buyer: i.creator, buyAmount: sol(i.firstBuySol), minimumAmountOut: new BN(1), referralTokenAccount: null }
    : undefined;
  const token = { name: i.name, symbol: i.symbol, uri: i.uri };

  if (i.presetConfig) {
    const tx = await dbc.creator.createPoolWithFirstBuy({
      createPoolParam: { ...token, payer: i.creator, poolCreator: i.creator, config: i.presetConfig, baseMint: baseMint.publicKey },
      firstBuyParam: firstBuy,
    });
    return {
      steps: [{ label: "Launch token", tx, signers: [baseMint] }],
      pool: deriveDbcPoolAddress(NATIVE_MINT, baseMint.publicKey, i.presetConfig),
      baseMint: baseMint.publicKey,
      config: i.presetConfig,
    };
  }

  const config = Keypair.generate();
  const params = PRESETS[i.preset].build({ scale: i.scale, resolutionTime: i.resolutionTime });
  const { createConfigTx, createPoolWithFirstBuyTx } = await dbc.partner.createConfigAndPoolWithFirstBuy({
    ...params,
    config: config.publicKey,
    feeClaimer: i.author ?? i.platform,
    leftoverReceiver: i.platform,
    quoteMint: NATIVE_MINT,
    payer: i.creator,
    preCreatePoolParam: { ...token, poolCreator: i.creator, baseMint: baseMint.publicKey },
    firstBuyParam: firstBuy,
  });
  return {
    steps: [
      { label: "Create launch config", tx: createConfigTx, signers: [config] },
      { label: "Launch token", tx: createPoolWithFirstBuyTx, signers: [baseMint] },
    ],
    pool: deriveDbcPoolAddress(NATIVE_MINT, baseMint.publicKey, config.publicKey),
    baseMint: baseMint.publicKey,
    config: config.publicKey,
  };
}

/** Quote a bonding-curve trade. buy: amount in SOL; sell: amount in tokens (6 decimals). */
export async function curveQuote(conn: Connection, pool: PublicKey, side: "buy" | "sell", amount: number, slippageBps = 100) {
  const { dbc } = clients(conn);
  const vp = await dbc.state.getPool(pool);
  if (!vp) throw new Error("pool not found");
  const cfg = await dbc.state.getPoolConfig(vp.poolState.config);
  if (!cfg) throw new Error("config not found");
  const amountIn = side === "buy" ? sol(amount) : new BN(Math.round(amount * 1e6));
  const currentPoint = await dbcCurrentPoint(conn, cfg.activationType); // chain clock, not ours: fees are time-scheduled
  const q = dbc.pool.swapQuote2({
    virtualPool: vp,
    config: cfg,
    swapBaseForQuote: side === "sell",
    swapMode: SwapMode.PartialFill,
    amountIn,
    slippageBps,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint,
  });
  return { amountIn, quote: q };
}

export async function curveTradeStep(conn: Connection, owner: PublicKey, pool: PublicKey, side: "buy" | "sell", amount: number): Promise<Step> {
  const { dbc } = clients(conn);
  const { amountIn, quote } = await curveQuote(conn, pool, side, amount);
  if (!quote.minimumAmountOut) throw new Error("quote has no minimum out");
  const tx = await dbc.pool.swap2({
    owner,
    pool,
    swapBaseForQuote: side === "sell",
    swapMode: SwapMode.PartialFill, // the buy that completes the curve fills only up to the threshold
    amountIn,
    minimumAmountOut: quote.minimumAmountOut,
    referralTokenAccount: null,
  });
  return { label: side === "buy" ? "Buy" : "Sell", tx, signers: [] };
}

/** Permissionless keeper: locker (when creator vesting exists) then migration into DAMM v2. */
export async function graduateSteps(conn: Connection, payer: PublicKey, pool: PublicKey) {
  const { dbc } = clients(conn);
  const vp = (await dbc.state.getPool(pool))?.poolState;
  if (!vp) throw new Error("pool not found");
  const cfg = (await dbc.state.getPoolConfig(vp.config))!;
  const steps: Step[] = [];
  if (vp.migrationProgress === 1) steps.push({ label: "Lock creator vesting", tx: await dbc.migration.createLocker({ payer, pool }), signers: [] });
  const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[cfg.migrationFeeOption];
  const m = await dbc.migration.migrateToDammV2({ payer, pool, dammConfig });
  steps.push({ label: "Migrate to DAMM v2", tx: m.transaction, signers: [m.firstPositionNftKeypair, m.secondPositionNftKeypair] });
  return { steps, dammPool: deriveDammV2PoolAddress(dammConfig, vp.baseMint, cfg.quoteMint) };
}

export async function dammPoolFor(conn: Connection, pool: PublicKey) {
  const { dbc } = clients(conn);
  const vp = (await dbc.state.getPool(pool))?.poolState;
  const cfg = vp && (await dbc.state.getPoolConfig(vp.config));
  if (!vp || !cfg) return null;
  return deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[cfg.migrationFeeOption], vp.baseMint, cfg.quoteMint);
}

/** Trade on the graduated DAMM v2 pool. buy: SOL in; sell: tokens in. */
export async function dammTradeStep(conn: Connection, owner: PublicKey, dammPool: PublicKey, side: "buy" | "sell", amount: number, slippagePct = 1): Promise<Step & { out: BN }> {
  const { damm } = clients(conn);
  const ps = await damm.fetchPoolState(dammPool);
  const buy = side === "buy";
  const input = buy ? ps.tokenBMint : ps.tokenAMint;
  const amountIn = buy ? sol(amount) : new BN(Math.round(amount * 1e6));
  const q = damm.getQuote2({
    inputTokenMint: input,
    slippage: slippagePct,
    currentPoint: await getCurrentPoint(conn, ps.activationType),
    poolState: ps,
    tokenADecimal: 6,
    tokenBDecimal: 9,
    hasReferral: false,
    swapMode: DammSwapMode.ExactIn,
    amountIn,
  });
  const tx = await damm.swap2({
    payer: owner,
    pool: dammPool,
    inputTokenMint: input,
    outputTokenMint: buy ? ps.tokenAMint : ps.tokenBMint,
    tokenAMint: ps.tokenAMint,
    tokenBMint: ps.tokenBMint,
    tokenAVault: ps.tokenAVault,
    tokenBVault: ps.tokenBVault,
    tokenAProgram: getTokenProgram(ps.tokenAFlag),
    tokenBProgram: getTokenProgram(ps.tokenBFlag),
    referralTokenAccount: null,
    swapMode: DammSwapMode.ExactIn,
    amountIn,
    minimumAmountOut: q.minimumAmountOut ?? new BN(1),
  });
  return { label: buy ? "Buy on DAMM v2" : "Sell on DAMM v2", tx, signers: [], out: q.outputAmount };
}

export async function claimPartnerFeesStep(conn: Connection, feeClaimer: PublicKey, pool: PublicKey): Promise<Step> {
  const { dbc } = clients(conn);
  const tx = await dbc.partner.claimPartnerTradingFeeToReceiver({
    feeClaimer,
    payer: feeClaimer,
    pool,
    maxBaseAmount: U64_MAX,
    maxQuoteAmount: U64_MAX,
    receiver: feeClaimer,
  });
  return { label: "Claim partner fees", tx, signers: [] };
}

export async function claimCreatorFeesStep(conn: Connection, creator: PublicKey, pool: PublicKey): Promise<Step> {
  const { dbc } = clients(conn);
  const tx = await dbc.creator.claimCreatorTradingFeeToReceiver({
    creator,
    payer: creator,
    pool,
    maxBaseAmount: U64_MAX,
    maxQuoteAmount: U64_MAX,
    receiver: creator,
  });
  return { label: "Claim creator fees", tx, signers: [] };
}

/** Publish a static preset as a shared on-chain config (author = feeClaimer). */
export async function publishPresetStep(conn: Connection, preset: PresetId, author: PublicKey, platform: PublicKey, opts: { scale?: number; creationFeeSol?: number } = {}) {
  const { dbc } = clients(conn);
  const config = Keypair.generate();
  const tx = await dbc.partner.createConfig({
    ...PRESETS[preset].build(opts),
    config: config.publicKey,
    feeClaimer: author,
    leftoverReceiver: platform,
    quoteMint: NATIVE_MINT,
    payer: author,
  });
  return { step: { label: `Publish ${PRESETS[preset].name}`, tx, signers: [config] } as Step, config: config.publicKey };
}
