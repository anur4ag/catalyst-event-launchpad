import { expect, mock, test } from "bun:test";
import { GET as pantaGET } from "../app/api/panta/[...path]/route";
import { POST as rpcPOST } from "../app/api/rpc/route";
import { allow } from "./ratelimit";

const from = (ip: string) => new Request("http://app/", { headers: { "x-real-ip": ip } });

test("each IP gets its own bucket: burst, then refused, then refilled over time", () => {
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) expect(allow("a", from("1.1.1.1"), 60, 5, 1, t)).toBe(true);
  expect(allow("a", from("1.1.1.1"), 60, 5, 1, t)).toBe(false);
  expect(allow("a", from("2.2.2.2"), 60, 5, 1, t)).toBe(true); // another visitor is unaffected
  expect(allow("a", from("1.1.1.1"), 60, 5, 1, t + 1_000)).toBe(true); // 60/min refills one token a second
  expect(allow("a", from("1.1.1.1"), 60, 5, 1, t + 1_000)).toBe(false);
  expect(allow("a", from("3.3.3.3"), 60, 5, 6, t)).toBe(false); // a cost above the burst never passes
  expect(allow("a", from("3.3.3.3"), 60, 5, 5, t)).toBe(true);
});

test("the RPC and Panta limits keep separate buckets for the same IP", () => {
  const t = 2_000_000;
  const ip = from("4.4.4.4");
  expect(allow("rpc", ip, 120, 240, 1, t)).toBe(true);
  expect(allow("panta", ip, 30, 60, 1, t)).toBe(true); // must not reset or shrink the RPC bucket
  expect(allow("rpc", ip, 120, 240, 239, t)).toBe(true);
  expect(allow("rpc", ip, 120, 240, 1, t)).toBe(false);

  const ip2 = from("5.5.5.5");
  expect(allow("panta", ip2, 30, 60, 60, t)).toBe(true);
  expect(allow("rpc", ip2, 120, 240, 1, t + 30_000)).toBe(true); // must not refill Panta at the RPC rate
  expect(allow("panta", ip2, 30, 60, 15, t + 30_000)).toBe(true); // 30 s at 30/min = 15 tokens
  expect(allow("panta", ip2, 30, 60, 1, t + 30_000)).toBe(false);
});

async function withUpstream(env: Record<string, string>, run: (upstream: ReturnType<typeof mock>) => Promise<void>) {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  Object.assign(process.env, env);
  delete process.env.PANTA_MODE;
  const upstream = mock(async () => Response.json([]));
  globalThis.fetch = upstream as unknown as typeof fetch;
  try {
    await run(upstream);
  } finally {
    globalThis.fetch = realFetch;
    process.env = saved;
  }
}

test("the RPC proxy charges every call in a batch and answers 429 without calling upstream", () =>
  withUpstream({ HELIUS_DEVNET_RPC_URL: "http://upstream.invalid/" }, async (upstream) => {
    const batch = (n: number) =>
      rpcPOST(new Request("http://app/api/rpc", { method: "POST", headers: { "x-real-ip": "9.9.9.9" }, body: JSON.stringify(Array(n).fill({ method: "getSlot" })) }));
    for (let i = 0; i < 12; i++) expect((await batch(20)).status).toBe(200); // 240 calls: the whole burst
    const r = await batch(1);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("5");
    expect(upstream).toHaveBeenCalledTimes(12);
  }));

test("the Panta proxy answers 429 past its burst without calling Panta", () =>
  withUpstream({ PANTA_API_KEY_LIVE: "pk_live_test" }, async (upstream) => {
    const get = () =>
      pantaGET(new Request("http://app/api/panta/categories/", { headers: { "x-real-ip": "7.7.7.7" } }), { params: Promise.resolve({ path: ["categories"] }) });
    for (let i = 0; i < 60; i++) expect((await get()).status).toBe(200);
    const r = await get();
    expect(r.status).toBe(429);
    expect((await r.json()).code).toBe("RATE_LIMITED");
    expect(upstream).toHaveBeenCalledTimes(60);
  }));
