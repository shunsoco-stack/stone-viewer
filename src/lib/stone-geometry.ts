import type { BufferGeometry } from "three";

type ThreeModule = typeof import("three");
type Point3 = readonly [number, number, number];

function hash3(x: number, y: number, z: number, seed: number): number {
  let hash = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  hash = Math.imul(hash ^ Math.imul(z, 2147483647) ^ seed, 1274126177);
  hash = Math.imul(hash ^ (hash >>> 13), 1597334677);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

const blend = (a: number, b: number, amount: number) => a + (b - a) * amount;
const smooth = (value: number) => value * value * (3 - 2 * value);

/** Seeded value noise. No model, texture, or remote asset is used. */
export function stoneNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const sx = smooth(x - ix);
  const sy = smooth(y - iy);
  const sz = smooth(z - iz);
  const at = (dx: number, dy: number, dz: number) =>
    hash3(ix + dx, iy + dy, iz + dz, seed | 0);

  return blend(
    blend(blend(at(0, 0, 0), at(1, 0, 0), sx), blend(at(0, 1, 0), at(1, 1, 0), sx), sy),
    blend(blend(at(0, 0, 1), at(1, 0, 1), sx), blend(at(0, 1, 1), at(1, 1, 1), sx), sy),
    sz,
  );
}

const signedPower = (value: number, power: number) =>
  Math.sign(value) * Math.pow(Math.abs(value), power);

/** A gently weathered, asymmetric superellipsoid, sampled on a unit sphere. */
export function stonePoint([x, y, z]: Point3, seed: number): Point3 {
  const broad = stoneNoise(x * 1.7 + 8.2, y * 1.7 + 3.1, z * 1.7 + 9.7, seed) - 0.5;
  const medium = stoneNoise(x * 4.8, y * 4.8, z * 4.8, seed + 11) - 0.5;
  const fine = stoneNoise(x * 13.3, y * 13.3, z * 13.3, seed + 73) - 0.5;
  const radius = 1 + broad * 0.24 + medium * 0.068 + fine * 0.018;
  const px = signedPower(x, 0.9) * radius;
  const py = signedPower(y, 0.91) * radius;
  const pz = signedPower(z, 0.94) * radius;

  return [
    px * 1.48 * (1 + y * 0.065) + y * 0.045,
    py * 0.87 - x * 0.078 - 0.035 * (1 - y * y),
    pz * 1.02 + x * y * 0.075,
  ];
}

/** Three is injected after capability detection, keeping the SVG path lightweight. */
export function createStoneGeometry(three: ThreeModule, seed: number): BufferGeometry {
  const widthSegments = 112;
  const heightSegments = 72;
  const geometry = new three.SphereGeometry(1, widthSegments, heightSegments);
  const positions = geometry.getAttribute("position");

  for (let index = 0; index < positions.count; index += 1) {
    const point = stonePoint(
      [positions.getX(index), positions.getY(index), positions.getZ(index)],
      seed,
    );
    positions.setXYZ(index, point[0], point[1], point[2]);
  }

  geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal");
  const stride = widthSegments + 1;

  // Weld only the normals on the UV seam. The material itself is UV-free.
  for (let row = 0; row <= heightSegments; row += 1) {
    const first = row * stride;
    const last = first + widthSegments;
    const normal = new three.Vector3(
      normals.getX(first) + normals.getX(last),
      normals.getY(first) + normals.getY(last),
      normals.getZ(first) + normals.getZ(last),
    ).normalize();
    normals.setXYZ(first, normal.x, normal.y, normal.z);
    normals.setXYZ(last, normal.x, normal.y, normal.z);
  }

  for (const row of [0, heightSegments]) {
    const normal = new three.Vector3();
    for (let column = 0; column <= widthSegments; column += 1) {
      const index = row * stride + column;
      normal.x += normals.getX(index);
      normal.y += normals.getY(index);
      normal.z += normals.getZ(index);
    }
    normal.normalize();
    for (let column = 0; column <= widthSegments; column += 1) {
      normals.setXYZ(row * stride + column, normal.x, normal.y, normal.z);
    }
  }

  positions.needsUpdate = true;
  normals.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Absolute degrees deliberately remain unwrapped: 360 → 361 never turns backwards. */
export function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/** Interruptible, non-overshooting approach with an exact final snap. */
export function advanceRotation(
  current: number,
  target: number,
  deltaSeconds: number,
  reducedMotion = false,
): number {
  if (reducedMotion || Math.abs(target - current) < 0.0005) return target;
  const factor = Math.exp(-16 * Math.min(0.1, Math.max(0, deltaSeconds)));
  const next = target + (current - target) * factor;
  // At very large cumulative counts, floating-point rounding can otherwise stall
  // before the threshold. Keep the integer target authoritative in that case.
  if (next === current && deltaSeconds > 0) return target;
  return Math.abs(target - next) < 0.0005 ? target : next;
}

/** Original 2D outline, sampled from the same stone instead of an image asset. */
export function createStoneOutline(seed: number): string {
  const points = Array.from({ length: 48 }, (_, index) => {
    const theta = (index / 48) * Math.PI * 2;
    const point = stonePoint([Math.cos(theta), Math.sin(theta), 0], seed);
    return [340 + point[0] * 115, 183 - point[1] * 115] as const;
  });
  const decimal = (value: number) => value.toFixed(2);
  const startX = (points[0][0] + points[points.length - 1][0]) / 2;
  const startY = (points[0][1] + points[points.length - 1][1]) / 2;
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return `Q${decimal(point[0])},${decimal(point[1])} ${decimal((point[0] + next[0]) / 2)},${decimal((point[1] + next[1]) / 2)}`;
  });
  return `M${decimal(startX)},${decimal(startY)} ${segments.join(" ")} Z`;
}
