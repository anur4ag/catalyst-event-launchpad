// Demo data: publishes the static presets (writes lib/deployments.json for NETWORK) and creates
// launches at every lifecycle stage, linked to markets from the active Panta catalog.
//   NETWORK=localnet RPC_URL=http://127.0.0.1:8899 ORIGIN=http://localhost:3000 bun scripts/seed.ts
import { readFileSync, writeFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { curveTradeStep, dammTradeStep, graduateSteps, launchSteps, publishPresetStep } from "../lib/actions";
import { getLaunch, metaUri } from "../lib/launches";
import { panta, toUnix, type Market } from "../lib/panta";
import type { PresetId } from "../lib/presets";
import { key } from "./keys";
import { conn, fund, run } from "./util";

const NETWORK = process.env.NETWORK ?? "localnet";
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";
const SCALE = Number(process.env.SCALE ?? 0.01);
const platform = key("partner");
const creator = key("creator");
const traders = [key("trader"), key("trader2"), key("trader3")];

await Promise.all([fund(platform, 5), fund(creator, 10), ...traders.map((t) => fund(t, 50))]);

console.log("1. publish static presets");
const path = new URL("../lib/deployments.json", import.meta.url);
const deployments = JSON.parse(readFileSync(path, "utf8"));
const configs: Partial<Record<PresetId, string>> = {};
for (const id of ["flat", "long", "parabolic"] as const) {
  const p = await publishPresetStep(conn, id, platform.publicKey, platform.publicKey, { scale: SCALE });
  await run(p.step, platform);
  configs[id] = p.config.toBase58();
}
deployments[NETWORK] = configs;
writeFileSync(path, `${JSON.stringify(deployments, null, 2)}\n`);

const { items } = await panta<{ items: Market[] }>("GET", "markets/");
const markets = await Promise.all(items.slice(0, 4).map((m) => panta<Market>("GET", `markets/${m.marketId}/`)));
console.log(`2. launches (${markets.length} Panta markets available)`);

async function buyTo(pool: PublicKey, target: number) {
  for (let i = 0; i < 40; i++) {
    const l = (await getLaunch(conn, pool.toBase58()))!;
    if (l.progress >= target) return;
    const t = traders[i % traders.length];
    const step = Math.min(0.25, Math.max(0.02, ((target - l.progress) * l.threshold) / 1e9));
    await run(await curveTradeStep(conn, t.publicKey, pool, "buy", step), t);
  }
}

async function launch(preset: PresetId, name: string, symbol: string, market: Market | null, stage: number | "graduated") {
  const eventLinked = preset === "event-horizon";
  const r = await launchSteps(conn, {
    preset,
    presetConfig: eventLinked ? undefined : new PublicKey(configs[preset]!),
    creator: creator.publicKey,
    platform: platform.publicKey,
    resolutionTime: market ? toUnix(market.resolutionTime) : undefined,
    scale: SCALE,
    name,
    symbol,
    uri: metaUri(ORIGIN, { marketId: market?.marketId, name, symbol }),
    firstBuySol: 0.02,
  });
  console.log(` $${symbol} (${preset})`);
  for (const s of r.steps) await run(s, creator);
  await buyTo(r.pool, stage === "graduated" ? 1 : stage);
  if (stage === "graduated") {
    const g = await graduateSteps(conn, traders[0].publicKey, r.pool);
    for (const s of g.steps) await run(s, traders[0]);
    await run(await dammTradeStep(conn, traders[1].publicKey, g.dammPool, "buy", 0.05), traders[1]);
  }
  console.log(`   → ${ORIGIN}/t/${r.pool.toBase58()}`);
}

const pick = (i: number) => markets[i % markets.length] ?? null;
const sym = (m: Market | null, fallback: string) =>
  m ? (m.title.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 2 && w !== "WILL").slice(0, 2).join("").slice(0, 8) || fallback) : fallback;

await launch("event-horizon", (pick(0)?.title ?? "Event token").slice(0, 32), sym(pick(0), "EVENT"), pick(0), 0.45);
await launch("event-horizon", (pick(1)?.title ?? "Graduated event").slice(0, 32), sym(pick(1), "GRAD") + "X", pick(1), "graduated");
await launch("parabolic", "Parabolic Pete", "PETE", null, 0.97);
await launch("flat", "Fair Share", "FAIR", null, 0.2);
await launch("long", "Long Haul", "HAUL", null, 0.05);
console.log("done ✓ — deployments written for", NETWORK, configs);
