import type { DecodedSchematic } from "../model/types";
import { blockIndex } from "./decode";
import { parseBlockState } from "./blockstate";

export interface PickResult {
  x: number;
  y: number;
  z: number;
  paletteId: number;
  /** canonical palette string, e.g. "minecraft:oak_stairs[facing=east,...]" */
  state: string;
  /** name without namespace */
  name: string;
  props: Record<string, string>;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Block under a raycast hit. `point` is the hit point and `normal` the face normal
 * (world space, e.g. intersection.face.normal transformed by the object's matrix);
 * the point is nudged into the hit block. Returns null outside the schematic.
 */
export function pickBlock(
  s: DecodedSchematic,
  point: Vec3Like,
  normal?: Vec3Like,
): PickResult | null {
  const e = 1e-3;
  const px = point.x - (normal?.x ?? 0) * e;
  const py = point.y - (normal?.y ?? 0) * e;
  const pz = point.z - (normal?.z ?? 0) * e;
  const x = Math.floor(px);
  const y = Math.floor(py);
  const z = Math.floor(pz);
  const [sx, sy, sz] = s.size;
  if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return null;
  const paletteId = s.blocks[blockIndex(s.size, x, y, z)];
  const state = s.palette[paletteId] ?? "minecraft:air";
  const { name, props } = parseBlockState(state);
  return { x, y, z, paletteId, state, name, props };
}
