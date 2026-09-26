// Metaplex off-chain metadata for Catalyst tokens. Stateless: everything comes from the URI, which
// is stored on-chain at launch (see metaUri in lib/launches.ts). ?img=1 returns the token's avatar.
export async function GET(req: Request, { params }: { params: Promise<{ market: string }> }) {
  const url = new URL(req.url);
  const market = (await params).market;
  const name = (url.searchParams.get("n") ?? "Catalyst token").slice(0, 32);
  const symbol = (url.searchParams.get("s") ?? "CAT").slice(0, 10);

  if (url.searchParams.get("img")) {
    const hue = [...symbol].reduce((a, c) => a + c.charCodeAt(0) * 37, 0) % 360;
    const esc = symbol.replace(/[<>&"']/g, "").slice(0, 4);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="hsl(${hue} 70% 18%)"/><circle cx="196" cy="60" r="28" fill="hsl(${hue} 90% 60%)"/><text x="128" y="160" font-family="system-ui,sans-serif" font-size="${esc.length > 3 ? 64 : 84}" font-weight="700" fill="hsl(${hue} 90% 80%)" text-anchor="middle">${esc}</text></svg>`;
    return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
  }

  const image = new URL(url);
  image.searchParams.set("img", "1");
  return Response.json({
    name,
    symbol,
    description: market === "-" ? `${name} launched on Catalyst.` : `${name} is an event token on Catalyst, linked to Panta market ${market}.`,
    image: image.toString(),
    external_url: `${url.origin}/`,
    attributes: market === "-" ? [] : [{ trait_type: "panta_market", value: market }],
  });
}
