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
  startTime: number;
  endTime: number;
  resolutionTime: number;
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

export type BuyQuote = { quoteId: string; marketId: string; side: Side; amountUsdc: string; shares: string; avgPrice: string; feeUsdc: string; expiresAt: string };
export type BuyBuild = { orderId: string; expectedShares: string; feeUsdc: string; instructions: Ix[]; recentBlockhash: string; lastValidBlockHeight: number };
export type Position = { marketId: string; category: string | null; side: Side; shares: string; phase: Phase; claimable: boolean; claimed: boolean; outcome: Side | null };
export type ClaimBuild = { outcome: string; winningShares: string; instructions: Ix[]; recentBlockhash: string; lastValidBlockHeight: number };

export class PantaError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export const pantaMode = (): "live" | "mock" =>
  process.env.PANTA_API_KEY && process.env.PANTA_MODE !== "mock" ? "live" : "mock";

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

export const isAllowed = (method: string, path: string) => ALLOWED.some(([m, re]) => m === method && re.test(path));

/** Call Panta. `path` has no leading slash and keeps Panta's required trailing slash. */
export async function panta<T>(method: "GET" | "POST", path: string, body?: unknown, query?: URLSearchParams): Promise<T> {
  if (pantaMode() === "mock") return mockPanta(method, path, body, query) as T;
  const qs = query?.toString();
  const res = await fetch(`${PANTA_BASE}/${path}${qs ? `?${qs}` : ""}`, {
    method,
    headers: { "X-Api-Key": process.env.PANTA_API_KEY!, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new PantaError(json.code ?? "INTERNAL_ERROR", json.message ?? res.statusText, res.status);
  return json as T;
}

/** Mark-to-market value of a position in USDC, per Panta's documented client-side estimate. */
export function positionValue(p: Pick<Position, "side" | "shares" | "outcome">, m?: Pick<Market, "yesPrice" | "noPrice">) {
  const shares = Number(p.shares);
  if (p.outcome) return p.outcome === p.side ? shares : 0;
  const price = Number((p.side === "yes" ? m?.yesPrice : m?.noPrice) ?? NaN);
  return Number.isFinite(price) ? shares * price : null;
}
