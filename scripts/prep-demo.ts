// Fresh tokens for demo recordings and retakes: each set is a Parabolic token with a full curve
// (ready to graduate) and a Flat token about a quarter full (room for a partial-fill buy).
//   SETS=2 NETWORK=devnet RPC_URL=... ORIGIN=https://catalyst-event-launchpad.vercel.app bun scripts/prep-demo.ts
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { curveTradeStep, launchSteps } from "../lib/actions";
import { getLaunch, metaUri } from "../lib/launches";
import type { PresetId } from "../lib/presets";
import { key } from "./keys";
import { conn, fund, LOCAL, run } from "./util";

const NETWORK = process.env.NETWORK ?? "localnet";
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";
const SETS = Number(process.env.SETS ?? 1);
const platform = key("partner");
const creator = key("creator");
const trader = key("trader");
const configs = JSON.parse(readFileSync(new URL("../lib/deployments.json", import.meta.url), "utf8"))[NETWORK] as Record<PresetId, string>;
if (LOCAL) await Promise.all([fund(platform, 5), fund(creator, 10), fund(trader, 50)]);

const tag = Date.now().toString(36).slice(-3).toUpperCase(); // keeps symbols unique across runs
const plan: { preset: PresetId; name: string; symbol: string; target: number }[] = [];
for (let i = 1; i <= SETS; i++) {
  plan.push({ preset: "parabolic", name: `Parabolic Pete ${tag}${i}`, symbol: `PETE${tag}${i}`, target: 1 });
  plan.push({ preset: "flat", name: `Fair Share ${tag}${i}`, symbol: `FAIR${tag}${i}`, target: 0.25 });
}

const pools: PublicKey[] = [];
for (const p of plan) {
  await fund(creator, 0.1, platform);
  const r = await launchSteps(conn, {
    preset: p.preset, presetConfig: new PublicKey(configs[p.preset]), creator: creator.publicKey, platform: platform.publicKey,
    name: p.name, symbol: p.symbol, uri: metaUri(ORIGIN, { name: p.name, symbol: p.symbol }), firstBuySol: 0.01,
  });
  for (const s of r.steps) await run(s, creator);
  pools.push(r.pool);
}

// Parabolic starts at a 30% anti-sniper fee that decays over 10 minutes.
if (!LOCAL) await Bun.sleep(11 * 60_000);

for (const [i, p] of plan.entries()) {
  for (let n = 0; n < 30; n++) {
    const l = (await getLaunch(conn, pools[i].toBase58()))!;
    if (l.progress >= p.target) break;
    const step = Math.max(0.01, ((p.target - l.progress) * l.threshold) / 1e9);
    await fund(trader, step + 0.03, platform);
    await run(await curveTradeStep(conn, trader.publicKey, pools[i], "buy", step), trader);
  }
  console.log(` $${p.symbol} → ${ORIGIN}/t/${pools[i].toBase58()}`);
}
console.log("done ✓");
