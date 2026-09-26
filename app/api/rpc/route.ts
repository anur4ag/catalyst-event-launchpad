// Browser -> Solana RPC proxy, so the provider URL (it embeds an API key) stays server-side.
// Set NEXT_PUBLIC_RPC_URL=/api/rpc and HELIUS_DEVNET_RPC_URL=<upstream> to use it.
// ponytail: no per-IP rate limit, so anyone can spend the upstream's credits through the allowed
// methods; add one (e.g. Upstash) if that happens.
const METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getBlockTime",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTokenLargestAccounts",
  "getTokenSupply",
  "getVersion",
  "isBlockhashValid",
  "requestAirdrop",
  "sendTransaction",
  "simulateTransaction",
]);

const rpcError = (status: number, message: string) => Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message } }, { status });

export async function POST(req: Request) {
  const upstream = process.env.HELIUS_DEVNET_RPC_URL;
  if (!upstream) return rpcError(503, "RPC proxy is not configured");
  const body = await req.text();
  if (body.length > 256_000) return rpcError(413, "Request too large");
  let calls: { method?: unknown }[];
  try {
    const json = JSON.parse(body);
    calls = Array.isArray(json) ? json : [json];
  } catch {
    return rpcError(400, "Invalid JSON");
  }
  if (!calls.length || calls.length > 20) return rpcError(403, "Batch must hold 1–20 calls");
  // Index, not find(): a falsy entry (null, 0, "") must be refused, not read as "nothing denied".
  const denied = calls.findIndex((c) => typeof c?.method !== "string" || !METHODS.has(c.method));
  if (denied !== -1) return rpcError(403, `Method not allowed: ${String(calls[denied]?.method)}`);
  const res = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store" });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
}
