import { expect, test } from "bun:test";
import { isAllowed, panta, positionValue, type BuyQuote, type Market } from "./panta";

test("proxy allowlist blocks account and key management", () => {
  expect(isAllowed("GET", "markets/")).toBe(true);
  expect(isAllowed("POST", "primaryorderquote/")).toBe(true);
  expect(isAllowed("GET", "account/")).toBe(false);
  expect(isAllowed("POST", "account/keys/")).toBe(false);
  expect(isAllowed("POST", "markets/create/quote/")).toBe(false); // needs PANTA_ALLOW_CREATE=1
  expect(isAllowed("GET", "markets/../account/")).toBe(false);
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
