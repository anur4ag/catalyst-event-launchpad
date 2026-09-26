import { expect, test } from "bun:test";
import { launchConfigFor } from "./config";

const deployed = { flat: "FlatShared", long: "LongShared", parabolic: "ParabolicShared" };

test("a ?config= link sticks to its own preset, through switching away and back", () => {
  const custom = { preset: "flat" as const, config: "FlatCustom" };
  expect(launchConfigFor("flat", custom, deployed)).toBe("FlatCustom");
  expect(launchConfigFor("long", custom, deployed)).toBe("LongShared"); // gate repro: flat link, then Long Curve
  expect(launchConfigFor("parabolic", custom, deployed)).toBe("ParabolicShared");
  expect(launchConfigFor("flat", custom, deployed)).toBe("FlatCustom"); // back again
  expect(launchConfigFor("event-horizon", custom, deployed)).toBeUndefined(); // builds its own config at launch
  expect(launchConfigFor("long", null, deployed)).toBe("LongShared");
});
