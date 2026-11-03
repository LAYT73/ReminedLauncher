export { schematicApi, loadAssets } from "./api/schematicApi";
export type {
  SchematicEntry,
  SchematicData,
  SchematicFormat,
  LocalizedText,
  Catalog,
  CatalogCategory,
  CatalogItem,
  CatalogDifficulty,
  DecodedSchematic,
  AssetsBundle,
} from "./model/types";
export { decodeSchematic, decodeBlocks, blockAt, paletteAt, blockIndex } from "./lib/decode";
export { parseBlockState, resolveBlockstate } from "./lib/blockstate";
export { buildAtlas } from "./lib/atlas";
export type { Atlas, AtlasEntry, AtlasLookup, TexClass } from "./lib/atlas";
export {
  createAssets,
  createAtlasFor,
  buildLayers,
  buildLayersIter,
  createMaterials,
} from "./lib/mesher";
export type {
  ResolvedAssets,
  LayerGeometry,
  BuildOptions,
  BuildProgress,
  LayerStyle,
  MaterialSet,
  SchematicMaterials,
} from "./lib/mesher";
export { LayerView } from "./lib/layerView";
export type { LayerState } from "./lib/layerView";
export { computeMaterials, materialItems, prettifyId } from "./lib/materials";
export type { MaterialLine, MaterialList, ItemCount } from "./lib/materials";
export { pickBlock } from "./lib/pick";
export type { PickResult } from "./lib/pick";
