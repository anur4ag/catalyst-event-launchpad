// Browser -> Panta proxy. Keeps the API key server-side and only forwards allowlisted paths.
import { isAllowed, panta, PantaError, pantaMode } from "@/lib/panta";

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = `${(await params).path.join("/")}/`;
  const method = req.method as "GET" | "POST";
  if (!isAllowed(method, path)) return Response.json({ code: "FORBIDDEN", message: `${method} ${path} is not exposed` }, { status: 403 });
  const url = new URL(req.url);
  try {
    const body = method === "POST" ? await req.json() : undefined;
    const data = await panta(method, path, body, url.searchParams);
    return Response.json(data, { headers: { "x-panta-mode": pantaMode() } });
  } catch (e) {
    const err = e instanceof PantaError ? e : new PantaError("INTERNAL_ERROR", (e as Error).message, 502);
    return Response.json({ code: err.code, message: err.message }, { status: err.status, headers: { "x-panta-mode": pantaMode() } });
  }
}

export { handle as GET, handle as POST };
