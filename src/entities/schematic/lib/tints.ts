import type { AssetsBundle } from "../model/types";
import { decodePng } from "./atlas";

export type RGB = [number, number, number];

export interface TintColors {
  grass: RGB;
  foliage: RGB;
}

/** Plains-ish fallbacks used if a colormap cannot be decoded. */
export const DEFAULT_TINTS: TintColors = {
  grass: hex(0x91bd59),
  foliage: hex(0x77ab2f),
};

export const WHITE: RGB = [1, 1, 1];
export const WATER_TINT: RGB = hex(0x3f76e4);

export function hex(c: number): RGB {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

async function sampleColormap(
  b64: string | undefined,
  temperature: number,
  downfall: number,
): Promise<RGB | null> {
  if (!b64) return null;
  try {
    const bmp = await decodePng(b64);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = downfall * temperature;
    const x = Math.min(bmp.width - 1, Math.max(0, Math.round((1 - temperature) * (bmp.width - 1))));
    const y = Math.min(bmp.height - 1, Math.max(0, Math.round((1 - d) * (bmp.height - 1))));
    const p = ctx.getImageData(x, y, 1, 1).data;
    bmp.close?.();
    return [p[0] / 255, p[1] / 255, p[2] / 255];
  } catch {
    return null;
  }
}

/** Samples grass/foliage colormaps at plains (temperature 0.8, downfall 0.4). */
export async function loadTintColors(bundle: AssetsBundle): Promise<TintColors> {
  const [grass, foliage] = await Promise.all([
    sampleColormap(bundle.colormaps?.grass, 0.8, 0.4),
    sampleColormap(bundle.colormaps?.foliage, 0.8, 0.4),
  ]);
  return {
    grass: grass ?? DEFAULT_TINTS.grass,
    foliage: foliage ?? DEFAULT_TINTS.foliage,
  };
}

const GRASS_LIKE = new Set([
  "grass_block",
  "short_grass",
  "grass",
  "tall_grass",
  "fern",
  "large_fern",
  "sugar_cane",
  "potted_fern",
  "bush",
  "pink_petals",
  "wildflowers",
]);
const FOLIAGE_LIKE = new Set([
  "oak_leaves",
  "jungle_leaves",
  "acacia_leaves",
  "dark_oak_leaves",
  "mangrove_leaves",
  "vine",
]);
const WATER_LIKE = new Set(["water", "bubble_column", "water_cauldron"]);

const BIRCH = hex(0x80a755);
const SPRUCE = hex(0x619961);
const LILY = hex(0x208030);
const DRY_FOLIAGE = hex(0x8c6c3a);

export function redstoneColor(power: number): RGB {
  const t = Math.max(0, Math.min(15, power)) / 15;
  const lo = hex(0x4b0000);
  const hi = hex(0xff3300);
  return [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t];
}

/** Stem colour as in vanilla: r = age*32, g = 255 - age*8, b = age*4. */
export function stemColor(age: number): RGB {
  const a = Math.max(0, Math.min(7, age));
  return [(a * 32) / 255, (255 - a * 8) / 255, (a * 4) / 255];
}

/** Colour for a face with `tintindex` >= 0 on block `name` (no namespace). */
export function tintColor(
  name: string,
  props: Record<string, string>,
  tintIndex: number,
  colors: TintColors,
): RGB {
  if (tintIndex < 0) return WHITE;
  if (GRASS_LIKE.has(name)) return colors.grass;
  if (FOLIAGE_LIKE.has(name)) return colors.foliage;
  if (name === "birch_leaves") return BIRCH;
  if (name === "spruce_leaves") return SPRUCE;
  if (name === "leaf_litter") return DRY_FOLIAGE;
  if (WATER_LIKE.has(name) || name.startsWith("water_cauldron")) return WATER_TINT;
  if (name === "redstone_wire") return redstoneColor(parseInt(props.power ?? "0", 10) || 0);
  if (name === "melon_stem" || name === "pumpkin_stem") {
    return stemColor(parseInt(props.age ?? "0", 10) || 0);
  }
  if (name === "attached_melon_stem" || name === "attached_pumpkin_stem") return stemColor(7);
  if (name === "lily_pad") return LILY;
  return WHITE;
}
