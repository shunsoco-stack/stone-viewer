import { describe, expect, it } from "vitest";
import * as three from "three";
import {
  advanceRotation,
  createStoneGeometry,
  createStoneOutline,
  degreesToRadians,
  stoneNoise,
  stonePoint,
} from "../../src/lib/stone-geometry";
import { shouldUseLightweightRenderer } from "../../src/components/stone-scene";

describe("original procedural stone", () => {
  it("uses reproducible noise in the range [0, 1]", () => {
    for (let index = 0; index < 100; index += 1) {
      const value = stoneNoise(index * 0.37, -index * 0.12, index * 0.61, 1234);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(stoneNoise(index * 0.37, -index * 0.12, index * 0.61, 1234)).toBe(value);
    }
  });

  it("generates the same shape from the same seed and a different shape from another", () => {
    expect(stonePoint([1, 0, 0], 314)).toEqual(stonePoint([1, 0, 0], 314));
    expect(stonePoint([1, 0, 0], 314)).not.toEqual(stonePoint([1, 0, 0], 315));
    expect(createStoneOutline(314)).toEqual(createStoneOutline(314));
    expect(createStoneOutline(314)).not.toEqual(createStoneOutline(315));
    expect(createStoneOutline(314)).not.toMatch(/NaN|Infinity/);
  });

  it("has finite unit normals, an asymmetric silhouette and a wide stone proportion", () => {
    const geometry = createStoneGeometry(three, 314159);
    const position = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const bounds = geometry.boundingBox!;
    const ratio = (bounds.max.x - bounds.min.x) / (bounds.max.y - bounds.min.y);
    expect(ratio).toBeGreaterThan(1.4);
    expect(ratio).toBeLessThan(1.95);
    expect(position.count).toBeLessThan(9000);
    for (let index = 0; index < position.count; index += 1) {
      expect(Number.isFinite(position.getX(index))).toBe(true);
      expect(Number.isFinite(position.getY(index))).toBe(true);
      expect(Number.isFinite(position.getZ(index))).toBe(true);
      const length = Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index));
      expect(length).toBeCloseTo(1, 5);
    }
    geometry.dispose();
  });
});

describe("absolute one-degree rotation", () => {
  it("converts full rotations without wrapping away the accumulated angle", () => {
    expect(degreesToRadians(1)).toBe(Math.PI / 180);
    expect(degreesToRadians(360)).toBe(2 * Math.PI);
    expect(degreesToRadians(720)).toBe(4 * Math.PI);
  });

  it("settles on exactly one degree without overshooting", () => {
    let current = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      const next = advanceRotation(current, 1, 1 / 30);
      expect(next).toBeGreaterThanOrEqual(current);
      expect(next).toBeLessThanOrEqual(1);
      current = next;
    }
    expect(current).toBe(1);
  });

  it("continues forwards across a revolution and accepts rapid target updates", () => {
    let current = 359;
    for (let target = 360; target <= 420; target += 1) {
      const next = advanceRotation(current, target, 1 / 30);
      expect(next).toBeGreaterThan(current);
      current = next;
    }
    for (let frame = 0; frame < 60; frame += 1) current = advanceRotation(current, 420, 1 / 30);
    expect(current).toBe(420);
  });

  it("uses exact, immediate changes for reduced motion", () => {
    expect(advanceRotation(0, 1, 1 / 30, true)).toBe(1);
    expect(advanceRotation(359, 360, 1 / 30, true)).toBe(360);
  });

  it("does not stall at large safe-integer counts or move without elapsed time", () => {
    const target = Number.MAX_SAFE_INTEGER;
    expect(advanceRotation(target - 1, target, 1 / 30)).toBe(target);
    expect(advanceRotation(0, 1, 0)).toBe(0);
  });
});

describe("lightweight renderer selection", () => {
  it("respects manual lite mode, Save-Data, low memory and low CPU counts", () => {
    expect(shouldUseLightweightRenderer("lite", {})).toBe(true);
    expect(shouldUseLightweightRenderer("auto", { saveData: true })).toBe(true);
    expect(shouldUseLightweightRenderer("auto", { deviceMemory: 2 })).toBe(true);
    expect(shouldUseLightweightRenderer("auto", { hardwareConcurrency: 2 })).toBe(true);
    expect(shouldUseLightweightRenderer("auto", { deviceMemory: 8, hardwareConcurrency: 8 })).toBe(false);
    expect(shouldUseLightweightRenderer("auto", {})).toBe(false);
  });
});
