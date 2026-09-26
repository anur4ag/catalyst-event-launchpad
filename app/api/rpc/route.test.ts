import { afterEach, expect, test } from "bun:test";
import { POST } from "./route";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
const call = (body: unknown) => POST(new Request("http://app/api/rpc", { method: "POST", body: JSON.stringify(body) }));

test("the RPC proxy refuses methods outside the allowlist without calling upstream", async () => {
  process.env.HELIUS_DEVNET_RPC_URL = "http://127.0.0.1:1/never-called";
  for (const method of ["getSignaturesForAddress", "getBlock", "minimumLedgerSlot", undefined]) {
    const r = await call({ jsonrpc: "2.0", id: 1, method });
    expect(r.status).toBe(403);
  }
  expect((await call([{ method: "getBalance" }, { method: "getBlock" }])).status).toBe(403); // one bad call poisons a batch
  expect((await POST(new Request("http://app/api/rpc", { method: "POST", body: "{nope" }))).status).toBe(400);
});

test("without an upstream configured the proxy says so instead of guessing one", async () => {
  delete process.env.HELIUS_DEVNET_RPC_URL;
  expect((await call({ jsonrpc: "2.0", id: 1, method: "getBalance" })).status).toBe(503);
});
