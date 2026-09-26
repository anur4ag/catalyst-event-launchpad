import { expect, test } from "bun:test";
import { isAllowed, isOpen, panta, pantaKey, parseMarketAccount, positionValue, type BuyQuote, type Market } from "./panta";

test("proxy allowlist blocks account and key management", () => {
  expect(isAllowed("GET", "markets/")).toBe(true);
  expect(isAllowed("POST", "primaryorderquote/")).toBe(true);
  expect(isAllowed("GET", "account/")).toBe(false);
  expect(isAllowed("POST", "account/keys/")).toBe(false);
  expect(isAllowed("POST", "markets/create/quote/")).toBe(false); // needs PANTA_ALLOW_CREATE=1
  expect(isAllowed("GET", "markets/../account/")).toBe(false);
});

test("a pk_live_ key can quote but cannot build trades unless PANTA_ALLOW_TRADE=1", () => {
  const saved = { ...process.env };
  process.env.PANTA_API_KEY = "pk_live_x";
  delete process.env.PANTA_ALLOW_TRADE;
  expect(isAllowed("POST", "primaryorderquote/")).toBe(true);
  expect(isAllowed("POST", "primaryorderbuild/")).toBe(false);
  expect(isAllowed("POST", "claim/build/")).toBe(false);
  process.env.PANTA_ALLOW_TRADE = "1";
  expect(isAllowed("POST", "primaryorderbuild/")).toBe(true);
  process.env.PANTA_API_KEY = "pk_test_x";
  delete process.env.PANTA_ALLOW_TRADE;
  expect(isAllowed("POST", "primaryorderbuild/")).toBe(true); // sandbox
  process.env.PANTA_API_KEY_LIVE = "pk_live_y"; // the live key wins for everything, so the gate is back
  expect(pantaKey()).toBe("pk_live_y");
  expect(isAllowed("POST", "primaryorderbuild/")).toBe(false);
  process.env.PANTA_MODE = "sandbox";
  expect(pantaKey()).toBe("pk_test_x");
  expect(isAllowed("POST", "primaryorderbuild/")).toBe(true);
  process.env = saved;
});

test("market account parser reads the question and rule, and rejects garbage", () => {
  const str = (s: string) => {
    const b = Buffer.alloc(4 + Buffer.byteLength(s));
    b.writeUInt32LE(Buffer.byteLength(s));
    b.write(s, 4);
    return b;
  };
  const acct = Buffer.concat([Buffer.alloc(328), str("Will GTA 6 release on November 19th, 2026"), str("Resolve YES if it ships on time. Else NO."), Buffer.alloc(64)]);
  expect(parseMarketAccount(acct)).toEqual({ title: "Will GTA 6 release on November 19th, 2026", description: "Resolve YES if it ships on time. Else NO." });
  expect(parseMarketAccount(Buffer.alloc(400))).toBeNull();
  expect(parseMarketAccount(Buffer.concat([Buffer.alloc(328), Buffer.from([0xff, 0xff, 0, 0])]))).toBeNull();
});

test("isOpen keeps only markets still taking orders", () => {
  const future = Math.floor(Date.now() / 1000) + 86_400;
  expect(isOpen({ phase: "secondary", resolved: false, endTime: future })).toBe(true);
  expect(isOpen({ phase: "primary", resolved: false, endTime: new Date(future * 1000).toISOString() })).toBe(true);
  expect(isOpen({ phase: "resolved", resolved: true, endTime: future })).toBe(false);
  expect(isOpen({ phase: "secondary", resolved: false, endTime: future - 2 * 86_400 })).toBe(false);
});

test("position value follows Panta's mark-to-market rules", () => {
  const m = { yesPrice: "0.52", noPrice: "0.48" };
  expect(positionValue({ side: "yes", shares: "38.40", outcome: null }, m)).toBeCloseTo(19.968);
  expect(positionValue({ side: "no", shares: "10", outcome: "no" })).toBe(10);
  expect(positionValue({ side: "yes", shares: "10", outcome: "no" })).toBe(0);
  expect(positionValue({ side: "yes", shares: "10", outcome: null })).toBeNull();
});

test("mock mode runs the full hedge flow: list -> detail -> quote -> build -> submit -> positions", async () => {
  delete process.env.PANTA_API_KEY;
  delete process.env.PANTA_API_KEY_LIVE;
  const { items } = await panta<{ items: Market[] }>("GET", "markets/");
  expect(items.length).toBeGreaterThan(3);
  expect(items.every((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m.marketId))).toBe(true);
  const id = items[0].marketId;
  const detail = await panta<Market>("GET", `markets/${id}/`);
  expect(Number(detail.yesPrice) + Number(detail.noPrice)).toBeCloseTo(1);
  const wallet = "Buyer111111111111111111111111111111111";
  const q = await panta<BuyQuote>("POST", "primaryorderquote/", { wallet, marketId: id, side: "no", amountUsdc: "20.00" });
  expect(Number(q.shares)).toBeGreaterThan(20);
  const b = await panta<{ orderId: string }>("POST", "primaryorderbuild/", { quoteId: q.quoteId, wallet });
  await panta("POST", "primaryordersubmit/", { orderId: b.orderId, signature: "demo", wallet });
  const pos = await panta<{ positions: { side: string; shares: string }[] }>("GET", "positions/", undefined, new URLSearchParams({ wallet }));
  expect(pos.positions).toEqual([expect.objectContaining({ side: "no", shares: q.shares })]);
});

test("toUnix accepts documented unix seconds and sandbox ISO strings", async () => {
  const { toUnix } = await import("./panta");
  expect(toUnix(1798765199)).toBe(1798765199);
  expect(toUnix("2027-01-01T00:00:00Z")).toBe(1798761600);
});
