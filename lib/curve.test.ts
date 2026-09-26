import { expect, test } from "bun:test";
import { curvePoints } from "./curve";
import { PRESETS } from "./presets";

for (const p of Object.values(PRESETS)) {
  test(`${p.id} curve starts at its initial mcap, rises monotonically, ends at the threshold near its migration mcap`, () => {
    const cfg = p.build({ resolutionTime: 1_800_000_000, now: 1_790_000_000 });
    const pts = curvePoints(cfg);
    const threshold = Number(cfg.migrationQuoteThreshold.toString()) / 1e9;
    expect(pts[0].price * 1e9).toBeCloseTo(p.initialMcap, 0);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].raised).toBeGreaterThanOrEqual(pts[i - 1].raised);
      expect(pts[i].price).toBeGreaterThan(pts[i - 1].price);
    }
    expect(pts.at(-1)!.raised).toBeCloseTo(threshold, 6);
    expect(pts.at(-1)!.price * 1e9 / p.migrationMcap).toBeGreaterThan(0.9);
    expect(pts.at(-1)!.price * 1e9 / p.migrationMcap).toBeLessThan(1.1);
  });
}
