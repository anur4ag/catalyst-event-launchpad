// Demo data: publishes the static presets (writes lib/deployments.json for NETWORK) and creates
// launches at every lifecycle stage, linked to markets from the active Panta catalog.
//   NETWORK=localnet RPC_URL=http://127.0.0.1:8899 ORIGIN=http://localhost:3000 bun scripts/seed.ts
// Off localnet everything is paid by .keys/partner.json, and buys wait out the anti-sniper fee ramps.
import { readFileSync, writeFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { curveTradeStep, dammTradeStep, graduateSteps, launchSteps, publishPresetStep } from "../lib/actions";
import { getLaunch, metaUri, suggestName, suggestSymbol } from "../lib/launches";
import { isOpen, panta, toUnix, type Market } from "../lib/panta";
import type { PresetId } from "../lib/presets";
import { key } from "./keys";
import { conn, fund, LOCAL, run } from "./util";

const NETWORK = process.env.NETWORK ?? "localnet";
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";
const SCALE = Number(process.env.SCALE ?? 0.01);
const platform = key("partner");
const creator = key("creator");
const traders = LOCAL ? [key("trader"), key("trader2"), key("trader3")] : [key("trader")];

if (LOCAL) await Promise.all([fund(platform, 5), fund(creator, 10), ...traders.map((t) => fund(t, 50))]);
const startBalance = await conn.getBalance(platform.publicKey);
console.log(`platform ${platform.publicKey.toBase58()} has ${startBalance / 1e9} SOL`);

console.log("1. static presets");
const path = new URL("../lib/deployments.json", import.meta.url);
const deployments = JSON.parse(readFileSync(path, "utf8"));
const configs: Partial<Record<PresetId, string>> = deployments[NETWORK] ?? {};
for (const id of ["flat", "long", "parabolic"] as const) {
  if (configs[id] && (await conn.getAccountInfo(new PublicKey(configs[id]!)))) continue; // already published here
  const p = await publishPresetStep(conn, id, platform.publicKey, platform.publicKey, { scale: SCALE });
  await run(p.step, platform);
  configs[id] = p.config.toBase58();
}
deployments[NETWORK] = configs;
writeFileSync(path, `${JSON.stringify(deployments, null, 2)}\n`);

const { items } = await panta<{ items: Market[] }>("GET", "markets/");
const markets = await Promise.all(items.filter(isOpen).slice(0, 4).map((m) => panta<Market>("GET", `markets/${m.marketId}/`)));
console.log(`2. launches (${markets.length} open Panta markets)`);

const pick = (i: number) => markets[i % markets.length] ?? null;
const sym = (m: Market | null, fallback: string) => (m && suggestSymbol(m.title).slice(0, 8)) || fallback;
const nm = (m: Market | null, fallback: string) => (m ? suggestName(m.title) : fallback);

const plan: { preset: PresetId; name: string; symbol: string; market: Market | null; stage: number | "graduated" }[] = [
  { preset: "event-horizon", name: nm(pick(0), "Event token"), symbol: sym(pick(0), "EVENT"), market: pick(0), stage: 0.45 },
  { preset: "event-horizon", name: nm(pick(1), "Graduated event"), symbol: `${sym(pick(1), "GRAD")}X`, market: pick(1), stage: "graduated" },
  { preset: "parabolic", name: "Parabolic Pete", symbol: "PETE", market: null, stage: 0.97 },
  { preset: "flat", name: "Fair Share", symbol: "FAIR", market: null, stage: 0.2 },
  { preset: "long", name: "Long Haul", symbol: "HAUL", market: null, stage: 0.05 },
];

const pools: PublicKey[] = [];
for (const p of plan) {
  await fund(creator, 0.1, platform);
  const r = await launchSteps(conn, {
    preset: p.preset,
    presetConfig: p.preset === "event-horizon" ? undefined : new PublicKey(configs[p.preset]!),
    creator: creator.publicKey,
    platform: platform.publicKey,
    resolutionTime: p.market ? toUnix(p.market.resolutionTime) : undefined,
    scale: SCALE,
    name: p.name,
    symbol: p.symbol,
    uri: metaUri(ORIGIN, { marketId: p.market?.marketId, name: p.name, symbol: p.symbol }),
    firstBuySol: 0.02,
  });
  console.log(` $${p.symbol} (${p.preset})`);
  for (const s of r.steps) await run(s, creator);
  pools.push(r.pool);
}

if (!LOCAL) {
  // Event Horizon starts at a 50% anti-sniper fee that decays over 15 min; don't pay it with scarce devnet SOL.
  console.log("3. waiting 16 min for launch fees to decay…");
  await Bun.sleep(16 * 60_000);
}

async function buyTo(pool: PublicKey, target: number) {
  for (let i = 0; i < 40; i++) {
    const l = (await getLaunch(conn, pool.toBase58()))!;
    if (l.progress >= target) return;
    const t = traders[i % traders.length];
    const step = Math.min(0.25, Math.max(0.01, ((target - l.progress) * l.threshold) / 1e9));
    await fund(t, step + 0.03, platform);
    await run(await curveTradeStep(conn, t.publicKey, pool, "buy", step), t);
  }
}

for (const [i, p] of plan.entries()) {
  await buyTo(pools[i], p.stage === "graduated" ? 1 : p.stage);
  if (p.stage === "graduated") {
    const [keeper, buyer] = [traders[0], traders[1 % traders.length]];
    await fund(keeper, 0.15, platform);
    const g = await graduateSteps(conn, keeper.publicKey, pools[i]);
    for (const s of g.steps) await run(s, keeper);
    await fund(buyer, 0.05, platform);
    await run(await dammTradeStep(conn, buyer.publicKey, g.dammPool, "buy", 0.02), buyer);
  }
  console.log(` $${p.symbol} → ${ORIGIN}/t/${pools[i].toBase58()}`);
}

const spent = (startBalance - (await conn.getBalance(platform.publicKey))) / 1e9;
console.log(`done ✓ — ${NETWORK} configs`, configs, LOCAL ? "" : `platform paid out ${spent.toFixed(3)} SOL`);
