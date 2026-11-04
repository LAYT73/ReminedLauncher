/** Contract: docs/RECIPES_INDEX.md (format 1). */
export type RecipeLocale = "en" | "ru";

export type RecipeSource = {
  packId: string;
  name: string;
  mcVersion: string;
  modCount: number;
  kind: string;
};

export type IconRef =
  | { k: "flat"; t: string; tint?: number; layers?: { t: string; tint?: number }[] }
  | { k: "cube"; top: string; side: string; front: string; tint?: { top?: number; side?: number; front?: number } }
  | { k: "cross"; t: string; tint?: number }
  | { k: "model"; gui: ModelGui; elements: ModelElement[] };

export type ModelGui = {
  rotation: [number, number, number];
  translation: [number, number, number];
  scale: [number, number, number];
};
export type ModelFaceDir = "up" | "down" | "north" | "south" | "east" | "west";
export type ModelFace = { t: string; uv: [number, number, number, number]; rotation?: 0 | 90 | 180 | 270; tint?: number };
export type ModelElement = {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: "x" | "y" | "z"; angle: number; rescale?: boolean };
  faces: Partial<Record<ModelFaceDir, ModelFace>>;
};

export type RecipeMod = { id: string; name: string; namespaces: string[] };
export type RecipeItem = { id: string; name: string; mod: string; icon: IconRef | null };

export type Ingredient = { items: string[]; tag?: string; count?: number };
export type Stack = { id: string; count: number };

export type RecipeLayout = "shaped" | "shapeless" | "cooking" | "stonecutting" | "smithing" | "process";

export type RecipeExtras = {
  time?: number;
  xp?: number;
  container?: Ingredient;
  tool?: Ingredient;
  fluid?: { id: string; amount: number };
  note?: string;
};

export type Recipe = {
  id: string;
  type: string;
  mod: string;
  station: string | null;
  layout: RecipeLayout;
  w?: number;
  h?: number;
  inputs: (Ingredient | null)[];
  outputs: Stack[];
  extras?: RecipeExtras;
};

export type RecipeIndex = {
  format: 1;
  source: { packId: string; name: string; mcVersion: string };
  locale: RecipeLocale;
  mods: RecipeMod[];
  items: RecipeItem[];
  tags: Record<string, string[]>;
  textures: Record<string, string>;
  recipes: Recipe[];
};
