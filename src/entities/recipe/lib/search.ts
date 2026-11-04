import type { RecipeItem } from "../model/types";
import type { RecipeLookup } from "./lookup";

type Haystack = { hay: string; modKey: string };
const cache = new WeakMap<RecipeLookup, Haystack[]>();

function haystacks(lookup: RecipeLookup): Haystack[] {
  let h = cache.get(lookup);
  if (!h) {
    h = lookup.items.map((i) => {
      const mod = lookup.modsById.get(i.mod);
      return {
        hay: `${i.name}\n${i.id}`.toLowerCase(),
        modKey: `${mod?.name ?? ""}\n${i.mod}`.toLowerCase(),
      };
    });
    cache.set(lookup, h);
  }
  return h;
}

/**
 * JEI-style matcher. Space-separated tokens are ANDed:
 *  - `@mod`  items whose mod name/id contains `mod`
 *  - `#tag`  items that are members of a tag whose id contains `tag`
 *  - text    item name (index locale) or id contains the text
 * Result keeps the lookup's item order.
 */
export function searchItems(lookup: RecipeLookup, query: string, modFilter: string | null = null): RecipeItem[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 && !modFilter) return lookup.items;
  const hs = haystacks(lookup);
  const tags = lookup.index.tags;
  const preds: ((i: number, id: string) => boolean)[] = [];
  for (const tok of tokens) {
    if (tok.startsWith("@")) {
      const q = tok.slice(1);
      if (q) preds.push((i) => hs[i].modKey.includes(q));
    } else if (tok.startsWith("#")) {
      const q = tok.slice(1);
      if (!q) continue;
      const members = new Set<string>();
      for (const [tag, ids] of Object.entries(tags)) {
        if (tag.toLowerCase().includes(q)) for (const id of ids) members.add(id);
      }
      preds.push((_i, id) => members.has(id));
    } else {
      preds.push((i) => hs[i].hay.includes(tok));
    }
  }
  const out: RecipeItem[] = [];
  for (let i = 0; i < lookup.items.length; i++) {
    const it = lookup.items[i];
    if (modFilter && it.mod !== modFilter) continue;
    if (preds.every((p) => p(i, it.id))) out.push(it);
  }
  return out;
}
