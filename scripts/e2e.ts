// Full lifecycle against real DBC + DAMM v2 programs (local validator from scripts/localnet.sh,
// or devnet), using the same lib/actions.ts the web app uses:
//   static preset: publish shared config -> launch on it
//   event-horizon: per-launch config + first buy -> buy to graduation -> locker -> DAMM v2
//   -> trade on DAMM v2 -> LP locks as configured -> DBC fee claims + DAMM v2 LP fee claims
//   RPC_URL=http://127.0.0.1:8899 bun scripts/e2e.ts
import {
  claimCreatorFeesStep,
  claimLpFeesStep,
  claimPartnerFeesStep,
  clients,
  curveTradeStep,
  dammPositions,
  dammTradeStep,
  graduateSteps,
  launchSteps,
  publishPresetStep,
} from "../lib/actions";
import { getLaunch, listLaunches } from "../lib/launches";
import { key } from "./keys";
import { conn, fund, RPC, run } from "./util";

const platform = key("partner");
const creator = key("creator");
const trader = key("trader");
const SCALE = Number(process.env.SCALE ?? 0.01);

const assert = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(`assertion failed: ${msg}`);
};

if (import.meta.main) {
  console.log("RPC", RPC, "scale", SCALE);
  await Promise.all([fund(platform, 5), fund(creator, 5), fund(trader, 50)]);
  const uri = (m: string) => `https://catalyst.example/api/meta/${m}?n=x&s=x`;

  console.log("1. static preset: publish + launch");
  const pub = await publishPresetStep(conn, "flat", platform.publicKey, platform.publicKey, { scale: SCALE });
  await run(pub.step, platform);
  const flat = await launchSteps(conn, {
    preset: "flat", presetConfig: pub.config, creator: creator.publicKey, platform: platform.publicKey,
    name: "Fair Coin", symbol: "FAIR", uri: uri("-"), firstBuySol: 0.01,
  });
  for (const s of flat.steps) await run(s, creator);

  console.log("2. event-horizon launch");
  const market = "MockBTC15ckDec31aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const resolutionTime = Math.floor(Date.now() / 1000) + 7 * 86_400;
  const eh = await launchSteps(conn, {
    preset: "event-horizon", creator: creator.publicKey, platform: platform.publicKey, scale: SCALE,
    resolutionTime,
    name: "BTC 150K", symbol: "BTC150K", uri: uri(market), firstBuySol: 0.05,
  });
  for (const s of eh.steps) await run(s, creator);
  const launch = await getLaunch(conn, eh.pool.toBase58());
  assert(launch?.marketId === market, "Panta market id round-trips through Metaplex metadata");
  const all = await listLaunches(conn, [platform.publicKey.toBase58()]);
  assert(all.some((l) => l.pool === eh.pool.toBase58()) && all.some((l) => l.pool === flat.pool.toBase58()), "both launches discoverable");
  console.log(`  pool ${eh.pool.toBase58()} threshold ${launch!.threshold / 1e9} SOL`);

  console.log("3. trade to graduation");
  await run(await curveTradeStep(conn, trader.publicKey, eh.pool, "sell", 1000), trader).catch(() => console.log("  (sell without tokens rejected, as expected)"));
  for (let i = 0; i < 30; i++) {
    const l = (await getLaunch(conn, eh.pool.toBase58()))!;
    console.log(`  progress ${(l.progress * 100).toFixed(1)}%`);
    if (l.progress >= 1) break;
    await run(await curveTradeStep(conn, trader.publicKey, eh.pool, "buy", 0.5), trader);
  }

  console.log("4. graduate (permissionless keeper)");
  const grad = await graduateSteps(conn, trader.publicKey, eh.pool);
  for (const s of grad.steps) await run(s, trader);
  assert((await getLaunch(conn, eh.pool.toBase58()))?.migrated, "pool marked migrated");

  console.log("5. trade on DAMM v2");
  await run(await dammTradeStep(conn, trader.publicKey, grad.dammPool, "buy", 0.1), trader);
  await run(await dammTradeStep(conn, trader.publicKey, grad.dammPool, "sell", 1000), trader);
  const ps = await clients(conn).damm.fetchPoolState(grad.dammPool);
  console.log(`  DAMM v2 pool ${grad.dammPool.toBase58()} liquidity ${ps.liquidity.toString().slice(0, 12)}…`);

  console.log("6. fee claims");
  const { dbc } = clients(conn);
  const fees = await dbc.state.getPoolFeeBreakdown(eh.pool);
  console.log(`  partner ${fees.partner.unclaimedQuoteFee.toNumber() / 1e9} SOL, creator ${fees.creator.unclaimedQuoteFee.toNumber() / 1e9} SOL`);
  await run(await claimPartnerFeesStep(conn, platform.publicKey, eh.pool), platform);
  await run(await claimCreatorFeesStep(conn, creator.publicKey, eh.pool), creator);

  console.log("7. DAMM v2 LP positions: locks match the preset, fees claimable while locked");
  const lps = await dammPositions(conn, grad.dammPool);
  const mine = (k: typeof creator) => lps.find((p) => p.owner === k.publicKey.toBase58())!;
  const [c, a] = [mine(creator), mine(platform)];
  assert(c && Math.round(c.share * 100) === 90 && c.vesting && c.vesting.start >= resolutionTime - 60, "creator LP: 90%, vesting starts after the event resolves");
  assert(a && a.permanent && Math.round(a.share * 100) === 10, "preset author LP: 10%, permanently locked");
  for (const [p, k] of [[c, creator], [a, platform]] as const) {
    assert(p.feeLamports > 0, "locked LP has earned fees");
    await run(await claimLpFeesStep(conn, k.publicKey, grad.dammPool, p), k);
  }
  assert((await dammPositions(conn, grad.dammPool)).every((p) => p.feeLamports === 0), "LP fees claimed");
  console.log("done ✓");
}
