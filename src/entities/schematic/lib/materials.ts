import type { DecodedSchematic } from "../model/types";
import { entryModels, type ResolvedAssets } from "./bake";
import { parseBlockState } from "./blockstate";

export interface MaterialLine {
  /** item-ish id without namespace, e.g. "oak_planks" */
  name: string;
  displayName: string;
  count: number;
  /** texture key from the block's model ("block/..."), or null */
  iconTexture: string | null;
  /** first palette string that yields this item (for 3D icons), or null */
  state: string | null;
}

export interface MaterialList {
  total: MaterialLine[];
  /** index = y */
  layers: MaterialLine[][];
}

const NO_ITEM = new Set([
  "air",
  "cave_air",
  "void_air",
  "structure_void",
  "light",
  "moving_piston",
  "piston_head",
  "bubble_column",
  "nether_portal",
  "end_portal",
  "end_gateway",
  "fire",
  "soul_fire",
  "frosted_ice",
]);

const ITEM_ALIASES: Record<string, string> = {
  redstone_wire: "redstone",
  redstone_wall_torch: "redstone_torch",
  wall_torch: "torch",
  soul_wall_torch: "soul_torch",
  copper_wall_torch: "copper_torch",
  tripwire: "string",
  wheat: "wheat_seeds",
  carrots: "carrot",
  potatoes: "potato",
  beetroots: "beetroot_seeds",
  melon_stem: "melon_seeds",
  pumpkin_stem: "pumpkin_seeds",
  attached_melon_stem: "melon_seeds",
  attached_pumpkin_stem: "pumpkin_seeds",
  sweet_berry_bush: "sweet_berries",
  cocoa: "cocoa_beans",
  kelp_plant: "kelp",
  tall_seagrass: "seagrass",
  bamboo_sapling: "bamboo",
  cave_vines: "glow_berries",
  cave_vines_plant: "glow_berries",
  weeping_vines_plant: "weeping_vines",
  twisting_vines_plant: "twisting_vines",
  big_dripleaf_stem: "big_dripleaf",
  water_cauldron: "cauldron",
  lava_cauldron: "cauldron",
  powder_snow_cauldron: "cauldron",
  pitcher_crop: "pitcher_pod",
  torchflower_crop: "torchflower_seeds",
  farmland: "dirt",
  potted_azalea_bush: "azalea",
  potted_flowering_azalea_bush: "flowering_azalea",
};

export interface ItemCount {
  name: string;
  count: number;
}

function itemNameFor(name: string): string {
  const alias = ITEM_ALIASES[name];
  if (alias) return alias;
  if (name.endsWith("_wall_banner")) return name.replace("_wall_banner", "_banner");
  if (name.endsWith("_wall_hanging_sign")) return name.replace("_wall_hanging_sign", "_hanging_sign");
  if (name.endsWith("_wall_sign")) return name.replace("_wall_sign", "_sign");
  if (name.endsWith("_wall_head")) return name.replace("_wall_head", "_head");
  if (name.endsWith("_wall_skull")) return name.replace("_wall_skull", "_skull");
  return name;
}

function num(v: string | undefined, d: number): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : d;
}

/**
 * Normalised material items for one palette string (usually one; a potted plant
 * yields the pot and the plant). Empty array = costs nothing / not an item.
 */
export function materialItems(state: string): ItemCount[] {
  const { name, props } = parseBlockState(state);
  if (NO_ITEM.has(name)) return [];

  if (name === "water") return props.level === undefined || props.level === "0" ? [{ name: "water_bucket", count: 1 }] : [];
  if (name === "lava") return props.level === undefined || props.level === "0" ? [{ name: "lava_bucket", count: 1 }] : [];

  if (props.half === "upper") return [];
  if (props.part === "head") return [];
  if (name.endsWith("chest") && props.type === "right") return [];

  if (name.startsWith("potted_")) {
    const plant = ITEM_ALIASES[name] ?? name.slice("potted_".length);
    return [
      { name: "flower_pot", count: 1 },
      { name: plant, count: 1 },
    ];
  }

  const item = itemNameFor(name);
  let count = 1;
  if (props.type === "double" && (name.endsWith("_slab") || name.endsWith("slab"))) count = 2;
  else if (item === "candle" || item.endsWith("_candle")) count = num(props.candles, 1);
  else if (item === "sea_pickle") count = num(props.pickles, 1);
  else if (item === "turtle_egg") count = num(props.eggs, 1);
  else if (item === "snow") count = num(props.layers, 1);
  else if (item === "pink_petals" || item === "wildflowers") count = num(props.flower_amount, 1);
  else if (item === "leaf_litter") count = num(props.segment_amount, 1);
  return [{ name: item, count }];
}

export function prettifyId(id: string): string {
  return id
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const ICON_PREFERENCE = ["top", "side", "all", "particle"];

function iconFor(state: string, item: string, assets: ResolvedAssets): string | null {
  if (item === "water_bucket") return "block/water_still";
  if (item === "lava_bucket") return "block/lava_still";
  const models = entryModels(state, assets);
  for (const em of models) {
    const tex = em.model.textures;
    for (const k of ICON_PREFERENCE) if (tex[k]) return tex[k];
  }
  for (const em of models) {
    const first = Object.values(em.model.textures)[0];
    if (first) return first;
  }
  return null;
}

function sortLines(lines: MaterialLine[]): MaterialLine[] {
  return lines.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Material list per layer and in total. `assets` is optional: without it
 * displayName is prettified and iconTexture is null.
 */
export function computeMaterials(
  s: DecodedSchematic,
  assets: ResolvedAssets | null,
): MaterialList {
  const [sx, sy, sz] = s.size;
  const stride = sx * sz;
  const items = s.palette.map(materialItems);

  // representative palette string per item (for icons)
  const rep = new Map<string, string>();
  items.forEach((list, id) => {
    for (const it of list) if (!rep.has(it.name)) rep.set(it.name, s.palette[id]);
  });

  const lineFor = (name: string, count: number): MaterialLine => {
    const bare = name;
    const display = assets?.bundle.itemNames?.[bare] ?? assets?.bundle.names?.[bare] ?? prettifyId(bare);
    const repState = rep.get(name);
    return {
      name,
      displayName: display,
      count,
      iconTexture: assets && repState ? iconFor(repState, name, assets) : null,
      state: repState ?? null,
    };
  };

  const total = new Map<string, number>();
  const layers: MaterialLine[][] = [];
  const hist = new Uint32Array(s.palette.length);
  for (let y = 0; y < sy; y++) {
    hist.fill(0);
    const base = y * stride;
    for (let i = 0; i < stride; i++) hist[s.blocks[base + i]]++;
    const layer = new Map<string, number>();
    for (let id = 1; id < hist.length; id++) {
      const n = hist[id];
      if (n === 0) continue;
      for (const it of items[id]) {
        const c = it.count * n;
        layer.set(it.name, (layer.get(it.name) ?? 0) + c);
        total.set(it.name, (total.get(it.name) ?? 0) + c);
      }
    }
    layers.push(sortLines([...layer].map(([n, c]) => lineFor(n, c))));
  }
  return { total: sortLines([...total].map(([n, c]) => lineFor(n, c))), layers };
}
