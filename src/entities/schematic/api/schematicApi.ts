import { call } from "@/shared/api/invoke";
import { CMD } from "@/shared/config/commands";
import type {
  AssetsBundle,
  Catalog,
  CatalogCategory,
  CatalogItem,
  LocalizedText,
  SchematicData,
  SchematicEntry,
} from "../model/types";

const assetsCache = new Map<string, Promise<AssetsBundle>>();

/** Loads (and memoizes per version+locale) the vanilla assets bundle. */
export function loadAssets(version: string, locale: string): Promise<AssetsBundle> {
  const key = `${version}|${locale}`;
  let p = assetsCache.get(key);
  if (!p) {
    p = (async () => {
      const path = await call<string>(CMD.schematicAssets, { version, locale });
      const text = await call<string>(CMD.schematicReadAssets, { path });
      return JSON.parse(text) as AssetsBundle;
    })();
    p.catch(() => assetsCache.delete(key));
    assetsCache.set(key, p);
  }
  return p;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

function normText(v: unknown): LocalizedText | null {
  if (!isObj(v)) return null;
  const out = { ru: str(v.ru), en: str(v.en) };
  return out.ru.trim() || out.en.trim() ? out : null;
}

function normItem(v: unknown): CatalogItem | null {
  if (!isObj(v)) return null;
  const name = normText(v.name);
  const size = v.size;
  if (
    !name ||
    typeof v.id !== "string" ||
    !v.id ||
    typeof v.category !== "string" ||
    typeof v.file !== "string" ||
    typeof v.sha256 !== "string" ||
    !Array.isArray(size) ||
    size.length !== 3 ||
    !size.every((n) => Number.isInteger(n) && n > 0)
  ) {
    return null;
  }
  const d = v.difficulty;
  return {
    ...(v as unknown as CatalogItem),
    name,
    description: normText(v.description) ?? { ru: "", en: "" },
    size: size as [number, number, number],
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === "string") : [],
    difficulty: d === "medium" || d === "hard" ? d : "easy",
    author: str(v.author),
    license: str(v.license),
    mcVersion: str(v.mcVersion),
    sourceUrl: typeof v.sourceUrl === "string" && v.sourceUrl ? v.sourceUrl : null,
    blockCount: typeof v.blockCount === "number" ? v.blockCount : 0,
    thumb: typeof v.thumb === "string" ? v.thumb : undefined,
  };
}

function normCatalog(raw: unknown): Catalog {
  const c = isObj(raw) ? raw : {};
  const seen = new Set<string>();
  const items = (Array.isArray(c.items) ? c.items : [])
    .map(normItem)
    .filter((i): i is CatalogItem => !!i && !seen.has(i.id) && !!seen.add(i.id));
  const categories = (Array.isArray(c.categories) ? c.categories : []).flatMap((x): CatalogCategory[] => {
    const name = isObj(x) ? normText(x.name) : null;
    return isObj(x) && typeof x.id === "string" && x.id && name ? [{ id: x.id, name }] : [];
  });
  return {
    version: 1,
    updatedAt: str(c.updatedAt),
    baseUrl: str(c.baseUrl),
    categories,
    items,
  };
}

export const schematicApi = {
  list: () => call<SchematicEntry[]>(CMD.schematicList),
  import: (path: string) => call<SchematicEntry>(CMD.schematicImport, { path }),
  remove: (id: string) => call(CMD.schematicDelete, { id }),
  rename: (id: string, name: string) => call(CMD.schematicRename, { id, name }),
  setBuilt: (id: string, layers: number[]) =>
    call(CMD.schematicSetBuilt, { id, layers }),
  load: (id: string) => call<SchematicData>(CMD.schematicLoad, { id }),
  loadAssets,
  catalog: async (force: boolean): Promise<{ catalog: Catalog; stale: boolean }> => {
    const raw = JSON.parse(await call<string>(CMD.schematicCatalog, { force })) as {
      stale?: boolean;
      catalog?: unknown;
    };
    return { catalog: normCatalog(raw.catalog), stale: raw.stale === true };
  },
  catalogThumb: (itemId: string) =>
    call<string | null>(CMD.schematicCatalogThumb, { itemId }),
  install: (itemId: string, locale: string) =>
    call<SchematicEntry>(CMD.schematicInstall, { itemId, locale }),
};
