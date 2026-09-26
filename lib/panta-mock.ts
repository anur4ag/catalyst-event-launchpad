// Recorded-shape fixtures for Panta mock mode (no API key yet, or offline demos).
// Shapes follow docs.panta.market exactly; values are illustrative and the UI labels them "demo".
import type { BuyQuote, Market, Position, Side, Trade } from "./panta";
import { PantaError } from "./panta";

const now = () => Math.floor(Date.now() / 1000);
const DAY = 86_400;

// Base58-looking ids (no 0/O/I/l) so the same routing regexes apply as in live mode.
const seed: (Omit<Market, "startTime" | "endTime" | "resolutionTime"> & { endsIn: number })[] = [
  m("MockBTC15ckDec31aaaaaaaaaaaaaaaaaaaaaaaaaaaa", "crypto", "BTC above $150k on Dec 31?", 0.34, 96, "18450.00"),
  m("MockSoLDexVsEthaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "crypto", "Solana DEX volume beats Ethereum in October?", 0.61, 35, "9210.50"),
  m("MockFedCutNovaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "finance", "Fed cuts rates at the November meeting?", 0.72, 41, "25400.00"),
  m("MockSpaceXStarshipaaaaaaaaaaaaaaaaaaaaaaaaaa", "science", "Starship reaches orbit before Nov 30?", 0.48, 65, "4120.25"),
  m("MockCricketSeriesaaaaaaaaaaaaaaaaaaaaaaaaaaa", "sports", "India wins the next ODI series vs Australia?", 0.57, 20, "13380.00"),
  m("MockAcademyBestPicaaaaaaaaaaaaaaaaaaaaaaaaaa", "entertainment", "A streaming-first film wins Best Picture?", 0.22, 160, "2990.00"),
];

function m(marketId: string, category: string, title: string, yes: number, endsIn: number, volumeUsdc: string) {
  return {
    marketId,
    category,
    title,
    description: `${title} Resolves from the listed sources of truth.`,
    images: [],
    phase: "primary" as const,
    marketType: "standard" as const,
    region: "Global",
    resolved: false,
    status: "open",
    volumeUsdc,
    yesPrice: yes.toFixed(2),
    noPrice: (1 - yes).toFixed(2),
    endsIn,
  };
}

const markets = (): Market[] =>
  seed.map(({ endsIn, ...rest }) => ({
    ...rest,
    startTime: now() - 7 * DAY,
    endTime: now() + endsIn * DAY,
    resolutionTime: now() + endsIn * DAY + 3600,
  }));

function trades(marketId: string): Trade[] {
  // Deterministic pseudo-tape so charts look stable between reloads.
  let x = [...marketId].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: 12 }, (_, i) => {
    const yes = rnd() > 0.45;
    const amt = (5 + rnd() * 120).toFixed(2);
    return {
      id: `${marketId.slice(0, 8)}-${i}`,
      marketId,
      wallet: `Mock${Math.floor(rnd() * 1e8)}wa11etaaaaaaaaaaaaaaaaaaaaaa`,
      isPrimary: true,
      yesAmount: yes ? amt : "0",
      noAmount: yes ? "0" : amt,
      feePaid: (Number(amt) * 0.02).toFixed(2),
      blockTime: now() - i * 1800 - Math.floor(rnd() * 900),
      signature: `mocksig${i}${marketId.slice(4, 12)}`,
    };
  });
}

// In-memory demo state: quotes and positions created through the mock buy flow.
const quotes = new Map<string, BuyQuote & { wallet: string }>();
const orders = new Map<string, BuyQuote & { wallet: string }>();
const positions = new Map<string, Position[]>();

export function mockPanta(method: string, path: string, body: any = {}, query?: URLSearchParams): unknown {
  const find = (id: string) => {
    const mk = markets().find((x) => x.marketId === id);
    if (!mk) throw new PantaError("MARKET_NOT_FOUND", "Market not found", 404);
    return mk;
  };
  let r: RegExpMatchArray | null;

  if (method === "GET" && path === "categories/")
    return { categories: ["sports", "crypto", "politics", "entertainment", "finance", "science", "world", "other"] };

  if (method === "GET" && path === "markets/") {
    const cat = query?.get("category");
    // List rows carry no live prices (same as the real API).
    const items = markets()
      .filter((x) => !cat || x.category === cat)
      .map((x) => ({ ...x, yesPrice: null, noPrice: null }));
    return { items, nextCursor: null };
  }
  if (method === "GET" && (r = path.match(/^markets\/([^/]+)\/$/))) return find(r[1]);
  if (method === "GET" && (r = path.match(/^markets\/([^/]+)\/trades\/$/))) return { marketId: r[1], items: trades(find(r[1]).marketId) };

  if (method === "GET" && path === "positions/") {
    const wallet = query?.get("wallet") ?? "";
    return { wallet, positions: positions.get(wallet) ?? [] };
  }

  if (method === "POST" && path === "primaryorderquote/") {
    const mk = find(body.marketId);
    const side: Side = String(body.side).toLowerCase() === "no" ? "no" : "yes";
    const amount = Number(body.amountUsdc);
    if (!(amount >= 1)) throw new PantaError("AMOUNT_TOO_SMALL", "Minimum is 1 USDC");
    const price = Number(side === "yes" ? mk.yesPrice : mk.noPrice);
    const fee = amount * 0.02;
    const avg = Math.min(0.99, price * (1 + amount / 20_000)); // tiny slippage on the primary curve
    const q = {
      quoteId: `qt_mock_${Date.now().toString(36)}`,
      marketId: mk.marketId,
      side,
      amountUsdc: amount.toFixed(2),
      shares: ((amount - fee) / avg).toFixed(2),
      avgPrice: avg.toFixed(6),
      feeUsdc: fee.toFixed(2),
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
      wallet: body.wallet,
    };
    quotes.set(q.quoteId, q);
    const { wallet: _w, ...pub } = q;
    return pub;
  }
  if (method === "POST" && path === "primaryorderbuild/") {
    const q = quotes.get(body.quoteId);
    if (!q) throw new PantaError("QUOTE_EXPIRED", "Quote expired");
    const orderId = `ord_mock_${Date.now().toString(36)}`;
    orders.set(orderId, q);
    // No instructions in mock mode: the client shows "demo — nothing signed or sent".
    return { orderId, quoteId: q.quoteId, wallet: q.wallet, marketId: q.marketId, side: q.side, amountUsdc: q.amountUsdc, expectedShares: q.shares, feeUsdc: q.feeUsdc, status: "built", instructions: [], recentBlockhash: "", lastValidBlockHeight: 0, mock: true };
  }
  if (method === "POST" && (path === "primaryordersubmit/" || path === "primaryorderverify/")) {
    const o = orders.get(body.orderId);
    if (!o) throw new PantaError("QUOTE_EXPIRED", "Order expired");
    if (path === "primaryordersubmit/") {
      const list = positions.get(o.wallet) ?? [];
      const existing = list.find((p) => p.marketId === o.marketId && p.side === o.side);
      if (existing) existing.shares = (Number(existing.shares) + Number(o.shares)).toFixed(2);
      else list.push({ marketId: o.marketId, category: find(o.marketId).category, side: o.side, shares: o.shares, phase: "primary", claimable: false, claimed: false, outcome: null });
      positions.set(o.wallet, list);
      orders.delete(body.orderId);
      return { orderId: body.orderId, status: "submitted", signature: body.signature };
    }
    return { orderId: body.orderId, status: "confirmed", signature: body.signature, marketId: o.marketId, side: o.side };
  }
  if (method === "POST" && path === "trades/") return { signature: body.signature, status: "processed", marketId: body.marketId, wallet: body.wallet, side: null, kind: "buy" };
  if (method === "POST" && path === "claim/build/") throw new PantaError("NOT_CLAIMABLE", "Demo markets are unresolved");

  throw new PantaError("INVALID_MARKET_PARAMS", `mock: unsupported ${method} ${path}`, 404);
}
