import { expect, mock, test } from "bun:test";
import { POST } from "../app/api/rpc/route";
import { allow } from "./ratelimit";

const from = (ip: string) => new Request("http://app/", { headers: { "x-real-ip": ip } });

test("each IP gets its own bucket: burst, then refused, then refilled over time", () => {
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) expect(allow(from("1.1.1.1"), 60, 5, 1, t)).toBe(true);
  expect(allow(from("1.1.1.1"), 60, 5, 1, t)).toBe(false);
  expect(allow(from("2.2.2.2"), 60, 5, 1, t)).toBe(true); // another visitor is unaffected
  expect(allow(from("1.1.1.1"), 60, 5, 1, t + 1_000)).toBe(true); // 60/min refills one token a second
  expect(allow(from("1.1.1.1"), 60, 5, 1, t + 1_000)).toBe(false);
  expect(allow(from("3.3.3.3"), 60, 5, 6, t)).toBe(false); // a cost above the burst never passes
  expect(allow(from("3.3.3.3"), 60, 5, 5, t)).toBe(true);
});

test("the RPC proxy charges every call in a batch and answers 429 without calling upstream", async () => {
  process.env.HELIUS_DEVNET_RPC_URL = "http://upstream.invalid/";
  const upstream = mock(async () => Response.json([]));
  const realFetch = globalThis.fetch;
  globalThis.fetch = upstream as unknown as typeof fetch;
  try {
    const batch = (n: number) =>
      POST(new Request("http://app/api/rpc", { method: "POST", headers: { "x-real-ip": "9.9.9.9" }, body: JSON.stringify(Array(n).fill({ method: "getSlot" })) }));
    for (let i = 0; i < 12; i++) expect((await batch(20)).status).toBe(200); // 240 calls: the whole burst
    const r = await batch(1);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("5");
    expect(upstream).toHaveBeenCalledTimes(12);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.HELIUS_DEVNET_RPC_URL;
  }
});
