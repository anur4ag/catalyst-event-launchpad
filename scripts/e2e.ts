// Full launch lifecycle against a real DBC + DAMM v2 deployment (local validator with cloned
// mainnet programs, or devnet): Event-Horizon config + pool + creator first buy -> trader buys to
// graduation -> locker -> migrate to DAMM v2 -> swap on DAMM v2 -> partner claims fees.
//   RPC_URL=http://127.0.0.1:8899 bun scripts/e2e.ts
import BN from "bn.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction, type Transaction } from "@solana/web3.js";
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress,
  deriveDbcPoolAddress,
  DynamicBondingCurveClient,
  SwapMode,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, getCurrentPoint, getTokenProgram, SwapMode as DammSwapMode } from "@meteora-ag/cp-amm-sdk";
import { PRESETS } from "../lib/presets";
import { key } from "./keys";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const dbc = DynamicBondingCurveClient.create(conn, "confirmed");
const damm = new CpAmm(conn);

const partner = key("partner"); // preset author = feeClaimer
const creator = key("creator");
const trader = key("trader");

const send = (label: string, tx: Transaction, ...signers: Keypair[]) =>
  sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" }).then((sig) => {
    console.log(`  ✓ ${label} ${sig.slice(0, 16)}…`);
    return sig;
  });

async function fund(kp: Keypair, sol: number) {
  if ((await conn.getBalance(kp.publicKey)) >= sol * LAMPORTS_PER_SOL) return;
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL), "confirmed");
}

console.log("RPC", RPC);
await Promise.all([fund(partner, 5), fund(creator, 5), fund(trader, 50)]);

// 1. Event-Horizon config + pool + creator first buy (per-launch config, event resolves in 7 days)
const resolutionTime = Math.floor(Date.now() / 1000) + 7 * 86_400;
const params = PRESETS["event-horizon"].build({ scale: 0.01, resolutionTime });
const config = Keypair.generate();
const baseMint = Keypair.generate();
const { createConfigTx, createPoolWithFirstBuyTx } = await dbc.partner.createConfigAndPoolWithFirstBuy({
  ...params,
  config: config.publicKey,
  feeClaimer: partner.publicKey,
  leftoverReceiver: partner.publicKey,
  quoteMint: NATIVE_MINT,
  payer: creator.publicKey,
  preCreatePoolParam: {
    name: "BTC 150K",
    symbol: "BTC150K",
    uri: "https://example.com/btc150k.json",
    poolCreator: creator.publicKey,
    baseMint: baseMint.publicKey,
  },
  firstBuyParam: {
    buyer: creator.publicKey,
    buyAmount: new BN(0.05 * LAMPORTS_PER_SOL),
    minimumAmountOut: new BN(1),
    referralTokenAccount: null,
  },
});
console.log("1. launch");
await send("create config", createConfigTx, creator, config);
await send("create pool + first buy", createPoolWithFirstBuyTx, creator, baseMint);
const pool = deriveDbcPoolAddress(NATIVE_MINT, baseMint.publicKey, config.publicKey);
console.log("  pool", pool.toBase58(), "threshold", Number(params.migrationQuoteThreshold) / LAMPORTS_PER_SOL, "SOL");

// 2. Trader buys until the curve completes (partial fill caps the last buy at the threshold)
console.log("2. buy to graduation");
for (let i = 0; i < 20; i++) {
  const progress = await dbc.state.getPoolQuoteTokenCurveProgress(pool);
  console.log(`  progress ${(progress * 100).toFixed(1)}%`);
  if (progress >= 1) break;
  const tx = await dbc.pool.swap2({
    owner: trader.publicKey,
    pool,
    swapBaseForQuote: false,
    swapMode: SwapMode.PartialFill,
    amountIn: new BN(1 * LAMPORTS_PER_SOL),
    minimumAmountOut: new BN(1),
    referralTokenAccount: null,
  });
  await send(`buy #${i + 1}`, tx, trader);
}

// 3. Locker (creator vesting) then migration into DAMM v2
console.log("3. graduate to DAMM v2");
await send("create locker", await dbc.migration.createLocker({ payer: trader.publicKey, pool }), trader);
const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[6]; // Customizable
const mig = await dbc.migration.migrateToDammV2({ payer: trader.publicKey, pool, dammConfig });
await send("migrate", mig.transaction, trader, mig.firstPositionNftKeypair, mig.secondPositionNftKeypair);
const dammPool = deriveDammV2PoolAddress(dammConfig, baseMint.publicKey, NATIVE_MINT);
console.log("  DAMM v2 pool", dammPool.toBase58());

// 4. Swap on the graduated pool
console.log("4. trade on DAMM v2");
const ps = await damm.fetchPoolState(dammPool);
const quote = damm.getQuote2({
  inputTokenMint: NATIVE_MINT,
  slippage: 5,
  currentPoint: await getCurrentPoint(conn, ps.activationType),
  poolState: ps,
  tokenADecimal: 6,
  tokenBDecimal: 9,
  hasReferral: false,
  swapMode: DammSwapMode.ExactIn,
  amountIn: new BN(0.1 * LAMPORTS_PER_SOL),
});
const swapTx = await damm.swap2({
  payer: trader.publicKey,
  pool: dammPool,
  inputTokenMint: NATIVE_MINT,
  outputTokenMint: ps.tokenAMint,
  tokenAMint: ps.tokenAMint,
  tokenBMint: ps.tokenBMint,
  tokenAVault: ps.tokenAVault,
  tokenBVault: ps.tokenBVault,
  tokenAProgram: getTokenProgram(ps.tokenAFlag),
  tokenBProgram: getTokenProgram(ps.tokenBFlag),
  referralTokenAccount: null,
  swapMode: DammSwapMode.ExactIn,
  amountIn: new BN(0.1 * LAMPORTS_PER_SOL),
  minimumAmountOut: quote.minimumAmountOut ?? new BN(1),
});
await send("DAMM v2 buy", swapTx, trader);

// 5. Preset author collects DBC partner trading fees
console.log("5. partner fees");
const fees = await dbc.state.getPoolFeeBreakdown(pool);
console.log("  partner unclaimed", fees.partner.unclaimedQuoteFee.toNumber() / LAMPORTS_PER_SOL, "SOL");
const claim = await dbc.partner.claimPartnerTradingFeeToReceiver({
  feeClaimer: partner.publicKey,
  payer: partner.publicKey,
  pool,
  maxBaseAmount: new BN("18446744073709551615"),
  maxQuoteAmount: new BN("18446744073709551615"),
  receiver: partner.publicKey,
});
await send("claim partner fees", claim, partner);
console.log("done");
