export type SchematicFormat = "litematic" | "schem" | "nbt";

export interface SchematicEntry {
  id: string;
  name: string;
  format: SchematicFormat;
  size: [number, number, number];
  blockCount: number;
  importedAt: string;
  builtLayers: number[];
  /** Set when the entry was installed from the built-in catalog. */
  catalogId?: string;
  author?: string;
  license?: string;
  sourceUrl?: string;
}

export interface LocalizedText {
  ru: string;
  en: string;
}

export interface CatalogCategory {
  id: string;
  name: LocalizedText;
}

export type CatalogDifficulty = "easy" | "medium" | "hard";

export interface CatalogItem {
  id: string;
  category: string;
  name: LocalizedText;
  description: LocalizedText;
  file: string;
  format: SchematicFormat;
  sha256: string;
  bytes: number;
  size: [number, number, number];
  blockCount: number;
  mcVersion: string;
  difficulty: CatalogDifficulty;
  tags: string[];
  author: string;
  license: string;
  sourceUrl: string | null;
  thumb?: string;
}

export interface Catalog {
  version: number;
  updatedAt: string;
  baseUrl: string;
  categories: CatalogCategory[];
  items: CatalogItem[];
}

export interface SchematicData {
  id: string;
  name: string;
  size: [number, number, number];
  /** Canonical "minecraft:oak_stairs[facing=east,...]" strings; palette[0] = air. */
  palette: string[];
  bits: 16;
  /** base64 of little-endian u16, index = x + z*sx + y*sx*sz */
  blocks: string;
}

/** Decoded schematic: block ids are palette indices. */
export interface DecodedSchematic {
  id: string;
  name: string;
  size: [number, number, number];
  palette: string[];
  blocks: Uint16Array;
}

export interface BlockstateVariant {
  model: string;
  x?: number;
  y?: number;
  uvlock?: boolean;
  weight?: number;
}

export type WhenClause = Record<string, unknown>;

export interface BlockstateJson {
  variants?: Record<string, BlockstateVariant | BlockstateVariant[]>;
  multipart?: {
    when?: WhenClause;
    apply: BlockstateVariant | BlockstateVariant[];
  }[];
}

export interface FaceJson {
  uv?: [number, number, number, number];
  texture: string;
  cullface?: string;
  rotation?: number;
  tintindex?: number;
}

export type FaceName = "down" | "up" | "north" | "south" | "west" | "east";

/** Texture variable value: a plain id, or (26.x) an object with a sprite. */
export type TextureValue = string | { sprite: string; force_translucent?: boolean };

export interface ElementRotation {
  origin: [number, number, number];
  /** classic single-axis form */
  axis?: "x" | "y" | "z";
  angle?: number;
  rescale?: boolean;
  /** multi-axis form (applied x, then y, then z) */
  x?: number;
  y?: number;
  z?: number;
}

export interface ElementJson {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: ElementRotation;
  shade?: boolean;
  faces: Partial<Record<FaceName, FaceJson>>;
}

export interface ModelJson {
  parent?: string;
  ambientocclusion?: boolean;
  textures?: Record<string, TextureValue>;
  elements?: ElementJson[];
}

export interface AssetsBundle {
  version: string;
  blockstates: Record<string, BlockstateJson>;
  models: Record<string, ModelJson>;
  /** key "block/<path>" or "entity/<path>" -> base64 png */
  textures: Record<string, string>;
  animated: string[];
  colormaps: { grass: string; foliage: string };
  names: Record<string, string>;
  /** item.minecraft.<id> display names (absent in old caches) */
  itemNames?: Record<string, string>;
}

/** A reference to a model produced by blockstate resolution. */
export interface ModelRef {
  model: string;
  x: number;
  y: number;
  uvlock: boolean;
}

/** Model with parents merged and texture references resolved to texture keys. */
export interface ResolvedModel {
  elements: ElementJson[];
  /** variable -> texture key ("block/x" / "entity/x"); unresolved refs are absent */
  textures: Record<string, string>;
  /** variables whose texture is flagged force_translucent */
  translucent: Record<string, true>;
}

export type Dir6 = 0 | 1 | 2 | 3 | 4 | 5;
