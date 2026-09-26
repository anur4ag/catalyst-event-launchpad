// Thin typed Panta API client (https://docs.panta.market). Server-side only: the API key must
// never reach the browser (Panta ToS §3). Without PANTA_API_KEY, or with PANTA_MODE=mock, it
// serves recorded fixtures so the app runs end to end; the UI labels that data as a demo.
import { mockPanta } from "./panta-mock";

export const PANTA_BASE = "https://live-api.panta.market/api/v1";

export type Side = "yes" | "no";
export type Phase = "primary" | "secondary" | "resolved" | "cancelled";

export type Market = {
  marketId: string;
  category: string;
  title: string;
  description: string;
  images: string[];
  phase: Phase;
  marketType: "standard" | "breaking";
  // Docs say unix seconds; the pk_test_ sandbox returns ISO strings. Read through toUnix().
  startTime: number | string;
  endTime: number | string;
  resolutionTime: number | string;
  region: string;
  resolved: boolean;
  status: string;
  volumeUsdc: string;
  yesPrice: string | null;
  noPrice: string | null;
};

export type Trade = {
  id: string | number;
  marketId: string;
  wallet: string;
  isPrimary: boolean;
  yesAmount: string | number;
  noAmount: string | number;
  feePaid: string | number;
  blockTime: number | null;
  signature: string;
};

export type Ix = { programId: string; data: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[] };

export type BuyQuote = { quoteId: string; marketId: string; side: Side; amountUsdc: string; shares: string; avgPrice?: string; feeUsdc: string; expiresAt: string };
export type BuyBuild = { orderId: string; expectedShares: string; feeUsdc: string; instructions: Ix[]; recentBlockhash: string; lastValidBlockHeight: number };
export type Position = { marketId: string; category: string | null; side: Side; shares: string; phase: Phase; claimable: boolean; claimed: boolean; outcome: Side | null };
export type ClaimBuild = { outcome: string; winningShares: string; instructions: Ix[]; recentBlockhash: string; lastValidBlockHeight: number };

/** Present on every pk_test_ sandbox response; the UI shows it verbatim. */
export type Disclaimer = { disclaimer?: string };

export const toUnix = (v: number | string) => (typeof v === "number" ? v : Math.floor(Date.parse(v) / 1000));

export class PantaError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** PANTA_API_KEY_LIVE (mainnet catalog) wins over PANTA_API_KEY; PANTA_MODE=sandbox forces the test key. */
export const pantaKey = () =>
  process.env.PANTA_MODE === "sandbox" ? process.env.PANTA_API_KEY : (process.env.PANTA_API_KEY_LIVE ?? process.env.PANTA_API_KEY);

export const pantaMode = (): "live" | "mock" => (pantaKey() && process.env.PANTA_MODE !== "mock" ? "live" : "mock");

export const pantaLabel = () =>
  pantaMode() === "mock" ? "demo fixtures (no Panta key)" : pantaKey()!.startsWith("pk_test_") ? "Panta sandbox (test key, no mainnet)" : "Panta mainnet";

/** Still taking orders: not resolved, cancelled, or past its end time. */
export const isOpen = (m: Pick<Market, "phase" | "resolved" | "endTime">) =>
  (m.phase === "primary" || m.phase === "secondary") && !m.resolved && toUnix(m.endTime) > Date.now() / 1000;

/** Paths the browser may reach through /api/panta. Account/key management is deliberately absent. */
const ALLOWED: [method: string, pattern: RegExp][] = [
  ["GET", /^categories\/$/],
  ["GET", /^markets\/$/],
  ["GET", /^markets\/[1-9A-HJ-NP-Za-km-z]{32,44}\/$/],
  ["GET", /^markets\/[1-9A-HJ-NP-Za-km-z]{32,44}\/trades\/$/],
  ["GET", /^positions\/$/],
  ["POST", /^primaryorder(quote|build|submit|verify)\/$/],
  ["POST", /^claim\/build\/$/],
  ["POST", /^trades\/$/],
];
// Market creation spends ~50 USDC per market on mainnet: opt-in only.
if (process.env.PANTA_ALLOW_CREATE === "1") ALLOWED.push(["POST", /^markets\/(create\/(quote|build)|register)\/$/]);

// pk_test_ keys hit Panta's sandbox (empty instructions, no mainnet). With a pk_live_ key, anything
// past a quote moves real USDC, so it also needs PANTA_ALLOW_TRADE=1.
const REAL_MONEY = /^(primaryorder(build|submit|verify)|claim\/build|trades)\/$/;

export const isAllowed = (method: string, path: string) =>
  ALLOWED.some(([m, re]) => m === method && re.test(path)) &&
  !(REAL_MONEY.test(path) && pantaKey()?.startsWith("pk_live_") && process.env.PANTA_ALLOW_TRADE !== "1");

/** Call Panta. `path` has no leading slash and keeps Panta's required trailing slash. */
export async function panta<T>(method: "GET" | "POST", path: string, body?: unknown, query?: URLSearchParams): Promise<T> {
  if (pantaMode() === "mock") return mockPanta(method, path, body, query) as T;
  if (method === "GET" && path === "markets/" && !query?.has("status")) return (await catalog(query)) as T;
  const json = await call<T>(method, path, body, query);
  if (method === "GET" && /^markets\/[^/]+\/$/.test(path)) {
    let m = json as Market;
    // Detail sometimes has null prices (and a different phase) where the list row has live prices;
    // show the list row's view so the token page agrees with the market the user picked.
    const row = m.yesPrice == null ? (await catalog()).items.find((r) => r.marketId === m.marketId) : undefined;
    if (row?.yesPrice != null) m = { ...m, phase: row.phase, status: row.status, yesPrice: row.yesPrice, noPrice: row.noPrice };
    return ((await withTitles([m]))[0] ?? m) as T;
  }
  return json;
}

let cached: { at: number; data: { items: Market[] } } | null = null;

/** Market list. Cursor pages repeat rows and cap at 50, so union the unfiltered, primary and secondary views. */
async function catalog(query?: URLSearchParams) {
  const plain = !query?.toString();
  if (plain && cached && Date.now() - cached.at < 60_000) return cached.data;
  // ponytail: misses markets past the first 50 of each view; fine at today's catalog size.
  const views = await Promise.all(
    ["", "primary", "secondary"].map((status) => {
      const q = new URLSearchParams(query);
      q.set("limit", "50");
      if (status) q.set("status", status);
      return call<{ items: Market[] }>("GET", "markets/", undefined, q);
    }),
  );
  const data = { ...views[0], items: await withTitles(dedupe(views.flatMap((v) => v.items))) };
  if (plain) cached = { at: Date.now(), data };
  return data;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, query?: URLSearchParams): Promise<T> {
  const qs = query?.toString();
  const res = await fetch(`${PANTA_BASE}/${path}${qs ? `?${qs}` : ""}`, {
    method,
    headers: { "X-Api-Key": pantaKey()!, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new PantaError(json.code ?? "INTERNAL_ERROR", json.message ?? res.statusText, res.status);
  return json as T;
}

// The mainnet catalog (pk_live_) often returns empty titles/descriptions and repeats rows across
// pages. The question and resolution rule are also stored in each market's account on chain, so we
// read them from there. Markets with no account (and so no title) are dropped from lists.
const CHAIN_RPC = process.env.PANTA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const QUESTION_OFFSET = 328; // borsh String question, then String rule, in Panta's market account
const chainText = new Map<string, { title: string; description: string } | null>();

const dedupe = (items: Market[]) => [...new Map(items.map((m) => [m.marketId, m])).values()];

/** Reads [u32 len][utf8] twice from QUESTION_OFFSET; null unless both look like text. */
export function parseMarketAccount(data: Buffer) {
  const read = (at: number) => {
    if (at + 4 > data.length) return null;
    const end = at + 4 + data.readUInt32LE(at);
    const s = end <= data.length ? data.subarray(at + 4, end).toString("utf8") : "";
    return /^[^\x00-\x08\x0e-\x1f]{8,}$/.test(s) ? { s, end } : null;
  };
  const q = read(QUESTION_OFFSET);
  const rule = q && read(q.end);
  return q && rule ? { title: q.s.trim(), description: rule.s.trim() } : null;
}

async function withTitles(items: Market[]): Promise<Market[]> {
  const missing = items.filter((m) => !(m.title && m.description) && !chainText.has(m.marketId)).map((m) => m.marketId);
  for (let i = 0; i < missing.length; i += 100) {
    const ids = missing.slice(i, i + 100);
    const res = await fetch(CHAIN_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [ids, { encoding: "base64" }] }),
    }).then((r) => r.json()).catch(() => null);
    if (!res?.result) continue; // RPC hiccup: leave uncached, retry next call
    res.result.value.forEach((a: { data: [string, string] } | null, j: number) =>
      chainText.set(ids[j], a ? parseMarketAccount(Buffer.from(a.data[0], "base64")) : null),
    );
  }
  return items.flatMap((m) => {
    const t = chainText.get(m.marketId);
    const title = m.title || t?.title;
    return title ? [{ ...m, title, description: m.description || t?.description || "" }] : [];
  });
}

/** Mark-to-market value of a position in USDC, per Panta's documented client-side estimate. */
export function positionValue(p: Pick<Position, "side" | "shares" | "outcome">, m?: Pick<Market, "yesPrice" | "noPrice">) {
  const shares = Number(p.shares);
  if (p.outcome) return p.outcome === p.side ? shares : 0;
  const price = Number((p.side === "yes" ? m?.yesPrice : m?.noPrice) ?? NaN);
  return Number.isFinite(price) ? shares * price : null;
}
