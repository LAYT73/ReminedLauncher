import type { Ingredient, Recipe, RecipeIndex, RecipeItem, RecipeMod } from "../model/types";

export type RecipeGroup = {
  key: string;
  /** Canonical recipe type of the tab. */
  type: string;
  station: string | null;
  recipes: Recipe[];
};

export type RecipeLookup = {
  index: RecipeIndex;
  /** Items in index order. */
  items: RecipeItem[];
  itemsById: Map<string, RecipeItem>;
  modsById: Map<string, RecipeMod>;
  recipesByOutput: Map<string, Recipe[]>;
  recipesByInput: Map<string, Recipe[]>;
};

/** Shaped/shapeless/special crafting share one tab. */
export function canonType(type: string): string {
  return /^minecraft:crafting_/.test(type) ? "minecraft:crafting" : type;
}

export function ingredientItems(ing: Ingredient | null | undefined, tags: Record<string, string[]>): string[] {
  if (!ing) return [];
  if (ing.items.length > 0) return ing.items;
  return ing.tag ? (tags[ing.tag] ?? []) : [];
}

function push(map: Map<string, Recipe[]>, id: string, r: Recipe) {
  const list = map.get(id);
  if (!list) map.set(id, [r]);
  else if (list[list.length - 1] !== r) list.push(r);
}

export function buildLookup(index: RecipeIndex): RecipeLookup {
  const modsById = new Map(index.mods.map((m) => [m.id, m]));
  // Keep the index order (the indexer sorts: minecraft first, then mods by name).
  const items = index.items;
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const recipesByOutput = new Map<string, Recipe[]>();
  const recipesByInput = new Map<string, Recipe[]>();

  for (const r of index.recipes) {
    for (const o of r.outputs) push(recipesByOutput, o.id, r);
    const seen = new Set<string>();
    const add = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      push(recipesByInput, id, r);
    };
    for (const ing of r.inputs) for (const id of ingredientItems(ing, index.tags)) add(id);
    for (const id of ingredientItems(r.extras?.container, index.tags)) add(id);
    for (const id of ingredientItems(r.extras?.tool, index.tags)) add(id);
    if (r.station) add(r.station);
  }
  return { index, items, itemsById, modsById, recipesByOutput, recipesByInput };
}

/** Recipes of an item grouped into station/type tabs (stable order of first appearance). */
export function groupRecipes(recipes: Recipe[]): RecipeGroup[] {
  const groups = new Map<string, RecipeGroup>();
  for (const r of recipes) {
    const type = canonType(r.type);
    const key = `${r.station ?? "-"}|${type}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, type, station: r.station, recipes: [] };
      groups.set(key, g);
    }
    g.recipes.push(r);
  }
  return [...groups.values()]
    .map((g, i) => ({ g, i, rank: tabRank(g) }))
    .sort((a, b) => a.rank - b.rank || (a.rank === VANILLA_TABS.length ? b.g.recipes.length - a.g.recipes.length : 0) || a.i - b.i)
    .map((x) => x.g);
}

/** Vanilla stations first, in this order; everything else (modded) after, by recipe count. */
const VANILLA_TABS = [
  "minecraft:crafting_table",
  "minecraft:furnace",
  "minecraft:blast_furnace",
  "minecraft:smoker",
  "minecraft:campfire",
  "minecraft:stonecutter",
  "minecraft:smithing_table",
];
const VANILLA_TYPES = [
  "minecraft:crafting",
  "minecraft:smelting",
  "minecraft:blasting",
  "minecraft:smoking",
  "minecraft:campfire_cooking",
  "minecraft:stonecutting",
  "minecraft:smithing_transform",
];

function tabRank(g: RecipeGroup): number {
  const bySt = g.station ? VANILLA_TABS.indexOf(g.station) : -1;
  if (bySt >= 0) return bySt;
  if (!g.station) {
    const byType = VANILLA_TYPES.indexOf(g.type);
    if (byType >= 0) return byType;
  }
  return VANILLA_TABS.length;
}

/** "farmersdelight:cooking" -> "Cooking"; "minecraft:blast_furnace_smelting" -> "Blast furnace smelting". */
export function prettyType(type: string): string {
  const path = type.includes(":") ? type.slice(type.indexOf(":") + 1) : type;
  const s = path.replace(/[_/]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : type;
}

export function modOfItem(lookup: RecipeLookup, id: string): RecipeMod | undefined {
  const it = lookup.itemsById.get(id);
  return it ? lookup.modsById.get(it.mod) : undefined;
}
