import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { MAX_LOCK_DURATION_IN_SECONDS, validateConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { cliffUntilResolution, PRESETS } from "./presets";

const now = 1_790_000_000;
const DAY = 86_400;
const leftoverReceiver = Keypair.generate().publicKey;

for (const preset of Object.values(PRESETS)) {
  for (const scale of [1, 0.01]) {
    test(`${preset.id} @ scale ${scale} passes DBC's own validation`, () => {
      const cfg = preset.build({ scale, resolutionTime: now + 30 * DAY, now });
      expect(() => validateConfigParameters({ ...cfg, leftoverReceiver })).not.toThrow();
      expect(cfg.curve.length).toBe(16);
      expect(cfg.migrationQuoteThreshold.gtn(0)).toBe(true);
    });
  }
}

test("event-horizon locks creator vesting and LP until resolution", () => {
  const cfg = PRESETS["event-horizon"].build({ resolutionTime: now + 30 * DAY, now });
  expect(cfg.lockedVesting.cliffDurationFromMigrationTime.toNumber()).toBe(30 * DAY);
  expect(cfg.creatorLiquidityVestingInfo.cliffDurationFromMigrationTime).toBe(30 * DAY);
  expect(cfg.creatorLiquidityVestingInfo.vestingPercentage).toBe(90);
  expect(cfg.partnerPermanentLockedLiquidityPercentage).toBe(10);
});

test("event-horizon requires an event", () => {
  expect(() => PRESETS["event-horizon"].build({ now })).toThrow("resolutionTime");
});

test("cliff clamps to zero for past events and to the 2-year lock cap", () => {
  expect(cliffUntilResolution(now - 10, now)).toBe(0);
  expect(cliffUntilResolution(now + 10 * 365 * DAY, now, 30 * DAY)).toBe(MAX_LOCK_DURATION_IN_SECONDS - 30 * DAY);
});

test("parabolic thins liquidity, flat stays even", () => {
  const liq = (id: "parabolic" | "flat") => PRESETS[id].build().curve.map((p) => BigInt(p.liquidity.toString()));
  const para = liq("parabolic");
  expect(para[0] > para[15]).toBe(true);
  const flat = liq("flat");
  expect(flat[0]).toBe(flat[15]);
});
