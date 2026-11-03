import type { DecodedSchematic, SchematicData } from "../model/types";

/** base64 (LE u16 payload) -> Uint16Array. */
export function decodeBlocks(b64: string): Uint16Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
  }
  return out;
}

export function decodeSchematic(data: SchematicData): DecodedSchematic {
  const blocks = decodeBlocks(data.blocks);
  const [sx, sy, sz] = data.size;
  if (blocks.length < sx * sy * sz) {
    throw new Error("schematic block data is shorter than its size");
  }
  return {
    id: data.id,
    name: data.name,
    size: data.size,
    palette: data.palette,
    blocks,
  };
}

export function blockIndex(
  size: readonly [number, number, number],
  x: number,
  y: number,
  z: number,
): number {
  return x + z * size[0] + y * size[0] * size[2];
}

/** Palette index at x,y,z (0 = air when out of bounds). */
export function blockAt(s: DecodedSchematic, x: number, y: number, z: number): number {
  const [sx, sy, sz] = s.size;
  if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return 0;
  return s.blocks[x + z * sx + y * sx * sz];
}

export function paletteAt(s: DecodedSchematic, x: number, y: number, z: number): string {
  return s.palette[blockAt(s, x, y, z)] ?? "minecraft:air";
}
