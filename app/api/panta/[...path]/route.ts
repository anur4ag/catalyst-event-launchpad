// Browser -> Panta proxy. Keeps the API key server-side and only forwards allowlisted paths.
import { isAllowed, panta, PantaError, pantaMode } from "@/lib/panta";
import { allow, tooMany } from "@/lib/ratelimit";

// Per IP. A minute of browsing makes about 7 calls; Panta allows the whole key 120 reads a minute.
const PANTA_PER_MIN = 30;
const PANTA_BURST = 60;

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = `${(await params).path.join("/")}/`;
  const method = req.method as "GET" | "POST";
  if (!isAllowed(method, path)) return Response.json({ code: "FORBIDDEN", message: `${method} ${path} is not exposed` }, { status: 403 });
  if (!allow(req, PANTA_PER_MIN, PANTA_BURST)) return tooMany({ code: "RATE_LIMITED", message: "Too many requests; try again in a few seconds" });
  const url = new URL(req.url);
  try {
    const body = method === "POST" ? await req.json() : undefined;
    const data = await panta(method, path, body, url.searchParams);
    // Tells the UI whether a quote can go on to a real buy (false for pk_live_ without PANTA_ALLOW_TRADE).
    return Response.json(data, { headers: { "x-panta-mode": pantaMode(), "x-panta-trade": isAllowed("POST", "primaryorderbuild/") ? "1" : "0" } });
  } catch (e) {
    const err = e instanceof PantaError ? e : new PantaError("INTERNAL_ERROR", (e as Error).message, 502);
    return Response.json({ code: err.code, message: err.message }, { status: err.status, headers: { "x-panta-mode": pantaMode() } });
  }
}

export { handle as GET, handle as POST };
