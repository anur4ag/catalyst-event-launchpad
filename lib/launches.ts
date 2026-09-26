// On-chain launch discovery. No database: every Catalyst config sets leftoverReceiver = platform
// (the field the SDK's getPoolConfigsByOwner filters on; feeClaimer stays the preset author), and
// each token's Metaplex metadata URI carries its linked Panta market id. Browser + scripts.
import type { Connection } from "@solana/web3.js";
import { deriveMintMetadata, DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";

export type Launch = {
  pool: string;
  config: string;
  baseMint: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  marketId: string | null;
  quoteReserve: number; // lamports
  threshold: number; // lamports
  progress: number; // 0..1
  migrated: boolean;
};

/** Token metadata URI served by /api/meta. Keeps the Panta link on-chain, inside Metaplex's 200-char uri. */
export function metaUri(origin: string, t: { marketId?: string | null; name: string; symbol: string }) {
  const q = new URLSearchParams({ n: t.name, s: t.symbol });
  return `${origin}/api/meta/${t.marketId || "-"}?${q}`;
}

export function parseMarketId(uri: string): string | null {
  const m = uri.match(/\/api\/meta\/([1-9A-HJ-NP-Za-km-z]{32,44})(?:\?|$)/);
  return m ? m[1] : null;
}

/** Name, symbol and uri from a Metaplex metadata account (borsh strings, NUL-padded). */
export function parseMetaplex(data: Buffer): { name: string; symbol: string; uri: string } {
  let o = 1 + 32 + 32;
  const str = () => {
    const len = data.readUInt32LE(o);
    const s = data.subarray(o + 4, o + 4 + len).toString("utf8").replace(/\0+$/, "");
    o += 4 + len;
    return s;
  };
  return { name: str(), symbol: str(), uri: str() };
}

const lamports = (x: { toString(): string }) => Number(x.toString());

export async function listLaunches(conn: Connection, owners: string[], extraConfigs: string[] = []): Promise<Launch[]> {
  const dbc = new DynamicBondingCurveClient(conn, "confirmed");
  const ownedConfigs = await Promise.all(owners.map((o) => dbc.state.getPoolConfigsByOwner(o)));
  const configs = new Map<string, { migrationQuoteThreshold: { toString(): string } }>();
  for (const list of ownedConfigs) for (const c of list) configs.set(c.publicKey.toBase58(), c.account);
  for (const addr of extraConfigs) {
    if (configs.has(addr)) continue;
    const c = await dbc.state.getPoolConfig(addr);
    if (c) configs.set(addr, c);
  }
  const pools = (await Promise.all([...configs.keys()].map((c) => dbc.state.getPoolsByConfig(c)))).flat();
  if (!pools.length) return [];

  const metas = await conn.getMultipleAccountsInfo(pools.map((p) => deriveMintMetadata(p.account.poolState.baseMint)));
  return pools
    .map((p, i) => {
      const cfg = configs.get(p.account.poolState.config.toBase58())!;
      const meta = metas[i] ? parseMetaplex(metas[i]!.data) : { name: "?", symbol: "?", uri: "" };
      const threshold = lamports(cfg.migrationQuoteThreshold);
      const quoteReserve = lamports(p.account.poolState.quoteReserve);
      return {
        pool: p.publicKey.toBase58(),
        config: p.account.poolState.config.toBase58(),
        baseMint: p.account.poolState.baseMint.toBase58(),
        creator: p.account.poolState.creator.toBase58(),
        ...meta,
        marketId: parseMarketId(meta.uri),
        quoteReserve,
        threshold,
        progress: threshold ? Math.min(1, quoteReserve / threshold) : 0,
        migrated: p.account.poolState.isMigrated === 1,
      };
    })
    .sort((a, b) => b.progress - a.progress);
}

export async function getLaunch(conn: Connection, pool: string): Promise<Launch | null> {
  const dbc = new DynamicBondingCurveClient(conn, "confirmed");
  const p = (await dbc.state.getPool(pool))?.poolState;
  if (!p) return null;
  const cfg = await dbc.state.getPoolConfig(p.config);
  const metaAcc = await conn.getAccountInfo(deriveMintMetadata(p.baseMint));
  const meta = metaAcc ? parseMetaplex(metaAcc.data) : { name: "?", symbol: "?", uri: "" };
  const threshold = lamports(cfg!.migrationQuoteThreshold);
  const quoteReserve = lamports(p.quoteReserve);
  return {
    pool,
    config: p.config.toBase58(),
    baseMint: p.baseMint.toBase58(),
    creator: p.creator.toBase58(),
    ...meta,
    marketId: parseMarketId(meta.uri),
    quoteReserve,
    threshold,
    progress: threshold ? Math.min(1, quoteReserve / threshold) : 0,
    migrated: p.isMigrated === 1,
  };
}

export const short = (s: string, n = 4) => `${s.slice(0, n)}…${s.slice(-n)}`;
