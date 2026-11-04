# Recipe index (Recipes tab)

Contract between the Rust indexer (`src-tauri/src/recipes/`) and the Recipes page (`src/entities/recipe`, `src/pages/recipes`).
The launcher reads an installed pack (client jar + enabled `mods/*.jar`, including jar-in-jar) without starting the game.

## Commands

| Command | Args | Returns |
|---|---|---|
| `recipe_sources` | – | `RecipeSource[]` – installed packs/instances that have a client jar |
| `recipe_index` | `{ packId: string, locale: "en" \| "ru", force?: boolean }` | absolute path of the cached index JSON (built on first call; can take a while) |
| `recipe_read_index` | `{ path: string }` | the index JSON text (path must be inside the recipe cache dir) |

```ts
type RecipeSource = { packId: string; name: string; mcVersion: string; modCount: number; kind: string };
```

## Index JSON (`format: 1`)

```ts
type RecipeIndex = {
  format: 1;
  source: { packId: string; name: string; mcVersion: string };
  locale: "en" | "ru";
  mods: { id: string; name: string; namespaces: string[] }[];   // includes { id: "minecraft", name: "Minecraft" }
  items: { id: string; name: string; mod: string; icon: IconRef | null }[]; // id = "ns:path"; mod = mods[].id
  tags: Record<string, string[]>;   // "ns:path" (no '#') -> resolved item ids
  textures: Record<string, string>; // "ns:path" (e.g. "minecraft:item/stick", "minecraft:block/oak_planks") -> base64 PNG; only textures used by icons
  recipes: Recipe[];
};

type IconRef =
  | { k: "flat"; t: string; tint?: number; layers?: { t: string; tint?: number }[] } // item sprite; layers = layer0, layer1, ... drawn in order (t = layer0)
  | { k: "cube"; top: string; side: string; front: string; tint?: { top?: number; side?: number; front?: number } }
  | { k: "cross"; t: string; tint?: number }                                         // plants
  | { k: "model"; gui: Gui; elements: Element[] };                                    // real block/entity geometry (format 2+)

// Same space as Minecraft block models: coordinates 0..16 (may exceed for multi-block items like beds),
// uv in 0..16 of the face texture (entity textures too: u = px * 16 / textureWidth).
type Gui = { rotation: [number, number, number]; translation: [number, number, number]; scale: [number, number, number] }; // model display.gui (default block: [30,225,0], [0,0,0], [0.625,0.625,0.625])
type Face = { t: string; uv: [number, number, number, number]; rotation?: 0 | 90 | 180 | 270; tint?: number };
type Element = {
  from: [number, number, number]; to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: "x" | "y" | "z"; angle: number; rescale?: boolean };
  faces: Partial<Record<"up" | "down" | "north" | "south" | "east" | "west", Face>>;
};

type Ingredient = { items: string[]; tag?: string; count?: number }; // alternatives; tag without '#'
type Stack = { id: string; count: number };

type Recipe = {
  id: string;            // recipe resource id, e.g. "minecraft:oak_planks"
  type: string;          // raw type, e.g. "minecraft:crafting_shaped", "farmersdelight:cooking"
  mod: string;           // mod id that owns the recipe type namespace (fallback: jar's mod id)
  station: string | null;// workstation item id if it exists in items, e.g. "minecraft:crafting_table"
  layout: "shaped" | "shapeless" | "cooking" | "stonecutting" | "smithing" | "process";
  w?: number; h?: number;            // shaped only
  inputs: (Ingredient | null)[];     // shaped: row-major w*h with nulls; smithing: [template, base, addition]
  outputs: Stack[];
  extras?: { time?: number; xp?: number; container?: Ingredient; tool?: Ingredient; fluid?: { id: string; amount: number }; note?: string };
};
```

Colors (`tint`) are `0xRRGGBB`. Texture PNGs may be animation strips: draw the top square frame only.
