import { afterEach, expect, test } from "bun:test";
import { GET, POST } from "./route";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/").filter(Boolean) }) });
const post = (path: string) => POST(new Request(`http://app/api/panta/${path}`, { method: "POST", body: "{}" }), ctx(path));

test("the proxy never forwards account/key management, and blocks real-money calls on a live key", async () => {
  process.env.PANTA_API_KEY_LIVE = "pk_live_test";
  delete process.env.PANTA_ALLOW_TRADE;
  delete process.env.PANTA_MODE;
  expect((await GET(new Request("http://app/api/panta/account/keys/"), ctx("account/keys"))).status).toBe(403);
  for (const p of ["primaryorderbuild/", "primaryordersubmit/", "claim/build/", "trades/", "markets/create/quote/"]) {
    const r = await post(p);
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("FORBIDDEN");
  }
});

test("responses tell the browser the data source and whether buying is possible", async () => {
  process.env.PANTA_MODE = "mock";
  const r = await GET(new Request("http://app/api/panta/markets/"), ctx("markets"));
  expect(r.status).toBe(200);
  expect(r.headers.get("x-panta-mode")).toBe("mock");
  expect(r.headers.get("x-panta-trade")).toBe("1"); // mock/sandbox orders move no money
  process.env.PANTA_API_KEY_LIVE = "pk_live_test";
  expect((await GET(new Request("http://app/api/panta/markets/"), ctx("markets"))).headers.get("x-panta-trade")).toBe("0");
});
