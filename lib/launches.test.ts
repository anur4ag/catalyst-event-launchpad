import { expect, test } from "bun:test";
import { metaUri, parseMarketId, parseMetaplex, suggestName, suggestSymbol } from "./launches";

const MARKET = "GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V";

test("the Panta market id survives the trip through the on-chain metadata uri", () => {
  const uri = metaUri("https://catalyst-demo.vercel.app", { marketId: MARKET, name: "$ANSEM reach a $1B market cap", symbol: "ANSEREA1B" });
  expect(uri.length).toBeLessThanOrEqual(200); // Metaplex MAX_URI_LENGTH
  expect(parseMarketId(uri)).toBe(MARKET);
  expect(parseMarketId(metaUri("http://localhost:3000", { name: "Fair Share", symbol: "FAIR" }))).toBeNull();
  expect(parseMarketId("https://evil.example/api/meta/not-a-key")).toBeNull();
});

test("parseMetaplex reads NUL-padded borsh strings after key, update authority and mint", () => {
  const str = (s: string, pad: number) => {
    const b = Buffer.alloc(4 + pad);
    b.writeUInt32LE(pad);
    b.write(s, 4);
    return b;
  };
  const data = Buffer.concat([Buffer.alloc(65), str("GTA 6 release", 32), str("GTARELNOV", 10), str("http://x/api/meta/" + MARKET, 200)]);
  expect(parseMetaplex(data)).toEqual({ name: "GTA 6 release", symbol: "GTARELNOV", uri: "http://x/api/meta/" + MARKET });
});

test("names and symbols suggested from a market question fit Metaplex and the launch form", () => {
  for (const q of ["Will $ANSEM reach a $1B market cap by December 31, 2026?", "Will GTA 6 release on November 19th, 2026", "Will Bitcoin drop below 58k in 2026?"]) {
    expect(suggestName(q).length).toBeLessThanOrEqual(32);
    expect(suggestName(q)).not.toMatch(/^Will|\s(by|on)$|[?,]$/);
    expect(suggestSymbol(q)).toMatch(/^[A-Z0-9]{2,10}$/);
  }
  expect(suggestName("Will GTA 6 release on November 19th, 2026")).toBe("GTA 6 release on November 19th");
});
