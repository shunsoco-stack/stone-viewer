import { describe, expect, it } from "vitest";
import {
  createStoneIdentity,
  createStoneState,
  DEFAULT_SEED,
  incrementRotation,
  isRotationCount,
  MAX_ROTATIONS,
  MAX_SEED,
  parseStoneState,
  randomStoneName,
  randomStoneSeed,
  serializeStoneState,
  STORAGE_KEY,
} from "../../src/lib/stone-state";
import { localDayKey } from "../../src/lib/viewing-time";

const NOW = new Date(2026, 7, 27, 12, 0, 0).getTime();

describe("stone identity", () => {
  it("has a versioned, namespaced storage key", () => {
    expect(STORAGE_KEY).toBe("stone-viewer:v1");
  });

  it("creates a reproducible identity using only the seed", () => {
    expect(createStoneIdentity(481_923)).toEqual(createStoneIdentity(481_923));
    expect(createStoneIdentity(481_923).id).not.toBe(createStoneIdentity(481_924).id);
    expect(createStoneIdentity(481_923).description.length).toBeGreaterThan(0);
  });

  it("normalizes invalid seeds and includes the valid uint32 endpoints", () => {
    for (const seed of [NaN, Infinity, -1, 0, 1.2, MAX_SEED + 1]) {
      expect(createStoneIdentity(seed).seed).toBe(DEFAULT_SEED);
    }
    expect(createStoneIdentity(1).seed).toBe(1);
    expect(createStoneIdentity(MAX_SEED).seed).toBe(MAX_SEED);
    expect(randomStoneSeed(() => 0)).toBe(1);
    expect(randomStoneSeed(() => 1 - Number.EPSILON)).toBe(MAX_SEED);
    expect(randomStoneSeed(() => NaN)).toBeGreaterThan(0);
  });

  it("picks a different name even if the random draw repeats", () => {
    const first = randomStoneName(undefined, () => 0);
    const second = randomStoneName(first, () => 0);
    expect(first).toBe("まどろみの石");
    expect(second).not.toBe(first);
    expect(randomStoneName(undefined, () => 0.9)).not.toBe(first);
  });
});

describe("integer degree counter", () => {
  it("advances by exactly one degree on every press and remains cumulative", () => {
    let rotations = 0;
    for (let press = 1; press <= 721; press += 1) {
      const previous = rotations;
      rotations = incrementRotation(rotations);
      expect(rotations - previous).toBe(1);
      expect(rotations).toBe(press);
    }
  });

  it("does not overflow the safe integer boundary", () => {
    expect(incrementRotation(MAX_ROTATIONS - 1)).toBe(MAX_ROTATIONS);
    expect(incrementRotation(MAX_ROTATIONS)).toBe(MAX_ROTATIONS);
    expect(isRotationCount(MAX_ROTATIONS)).toBe(true);
    for (const value of [-1, 0.5, NaN, Infinity, MAX_ROTATIONS + 1, "360", null]) {
      expect(isRotationCount(value)).toBe(false);
    }
    expect(incrementRotation(NaN)).toBe(1);
  });
});

describe("storage validation", () => {
  const fallback = createStoneState(1_923, "dark");

  it.each([null, "", "{", "null", "[]", "false", "42", '{"version":2}', '{"version":"1"}']) (
    "recovers from an absent or corrupt root: %s",
    (raw) => {
      expect(parseStoneState(raw, fallback, NOW)).toEqual(fallback);
    },
  );

  it("does not parse an oversized storage payload", () => {
    expect(parseStoneState(" ".repeat(32_769), fallback, NOW)).toEqual(fallback);
  });

  it("round-trips the full valid record without changing its identity", () => {
    const state = {
      ...createStoneState(938_527, "dark"),
      rotations: 720,
      mode: "ritual" as const,
      quality: "lite" as const,
      days: { [localDayKey(NOW)]: 75_321 },
    };
    expect(parseStoneState(serializeStoneState(state, NOW), fallback, NOW)).toEqual(state);
  });

  it.each([-1, 1.5, "359", null, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid saved rotation count: %s",
    (rotations) => {
      expect(parseStoneState(JSON.stringify({ version: 1, rotations }), fallback, NOW).rotations).toBe(0);
    },
  );

  it("salvages good fields and replaces invalid preferences and text", () => {
    const state = parseStoneState(
      JSON.stringify({
        version: 1,
        rotations: 359,
        theme: "invisible",
        mode: "paid",
        quality: "ultra",
        stone: { seed: 120, name: "x".repeat(65), description: "\u0000", id: "an-unrelated-id" },
        days: { [localDayKey(NOW)]: 3_000, "2026-08-26": -10, "2026-02-30": 100 },
      }),
      fallback,
      NOW,
    );
    expect(state.rotations).toBe(359);
    expect(state.theme).toBe("dark");
    expect(state.mode).toBe("free");
    expect(state.quality).toBe("auto");
    expect(state.stone).toEqual(createStoneIdentity(120));
    expect(state.days).toEqual({ [localDayKey(NOW)]: 3_000 });
  });

  it("keeps a valid renamed stone but derives the display ID from its seed", () => {
    const state = parseStoneState(
      JSON.stringify({ version: 1, stone: { seed: 12, name: "  まどろみの石  ", id: "forged" } }),
      fallback,
      NOW,
    );
    expect(state.stone.name).toBe("まどろみの石");
    expect(state.stone.id).toBe("ST-0000000C");
    expect(state.stone.description).toBe(createStoneIdentity(12).description);
  });

  it("does not let prototype-looking storage properties alter defaults", () => {
    const result = parseStoneState(
      '{"version":1,"__proto__":{"polluted":true},"days":{"__proto__":9000,"constructor":9000}}',
      fallback,
      NOW,
    );
    expect(result.days).toEqual({});
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(result).not.toHaveProperty("polluted");
  });

  it("returns independent nested values when falling back", () => {
    const recovered = parseStoneState(null, fallback, NOW);
    recovered.stone.name = "別の石";
    recovered.days[localDayKey(NOW)] = 3_000;
    expect(fallback.stone.name).not.toBe("別の石");
    expect(fallback.days).toEqual({});
  });
});
