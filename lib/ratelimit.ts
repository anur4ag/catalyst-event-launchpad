// Per-IP token bucket for the proxy routes, so one visitor can't burn the Helius or Panta quota.
// ponytail: in memory, so each serverless instance keeps its own buckets (the real ceiling is this
// times the instance count); move to Vercel's firewall or Upstash if abuse spreads across instances.
const buckets = new Map<string, { tokens: number; at: number }>();

/** Takes `cost` tokens from this IP's `name` bucket (refills `perMin` a minute, holds `burst`); false when empty. */
export function allow(name: string, req: Request, perMin: number, burst: number, cost = 1, now = Date.now()) {
  // Vercel overwrites both headers with the real client address, so a client can't pick its own.
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const key = `${name} ${ip}`; // one bucket per limit, so the RPC and Panta limits never share tokens
  if (buckets.size > 50_000) buckets.clear(); // bounds memory; resetting everyone's bucket is harmless
  const b = buckets.get(key) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 60_000) * perMin);
  b.at = now;
  buckets.set(key, b);
  if (b.tokens < cost) return false;
  b.tokens -= cost;
  return true;
}

export const tooMany = (body: unknown) =>
  Response.json(body, { status: 429, headers: { "retry-after": "5" } });
