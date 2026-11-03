import type { ElementJson, ModelJson, ResolvedModel, TextureValue } from "../model/types";

/** "minecraft:block/x" | "block/x" -> "block/x" */
export function stripNs(id: string): string {
  const i = id.indexOf(":");
  return i < 0 ? id : id.slice(i + 1);
}

/** Texture reference -> bundle texture key ("block/x" / "entity/x"). */
export function textureKey(ref: string): string {
  return stripNs(ref);
}

const MAX_DEPTH = 32;

/**
 * Resolves model parent chains. Child textures override parent textures,
 * elements come from the nearest model that defines them, "#ref" chains are
 * resolved. Builtin/parent-less models without elements yield no elements.
 */
export class ModelResolver {
  private cache = new Map<string, ResolvedModel | null>();

  constructor(private models: Record<string, ModelJson>) {}

  private raw(id: string): ModelJson | undefined {
    const k = stripNs(id);
    return this.models[k];
  }

  get(id: string): ResolvedModel | null {
    const k = stripNs(id);
    const hit = this.cache.get(k);
    if (hit !== undefined) return hit;
    const json = this.raw(k);
    const res = json ? this.resolveJson(json, k) : null;
    this.cache.set(k, res);
    return res;
  }

  /** Resolve an inline model object (e.g. hand-written entity models). */
  resolveInline(json: ModelJson, cacheKey?: string): ResolvedModel | null {
    if (cacheKey) {
      const hit = this.cache.get(cacheKey);
      if (hit !== undefined) return hit;
    }
    const res = this.resolveJson(json, cacheKey ?? "<inline>");
    if (cacheKey) this.cache.set(cacheKey, res);
    return res;
  }

  private resolveJson(json: ModelJson, _id: string): ResolvedModel | null {
    let elements: ElementJson[] | undefined;
    const rawTex: Record<string, TextureValue> = {};
    let cur: ModelJson | undefined = json;
    let depth = 0;
    while (cur && depth++ < MAX_DEPTH) {
      if (!elements && cur.elements) elements = cur.elements;
      if (cur.textures) {
        for (const [k, v] of Object.entries(cur.textures)) {
          if (!(k in rawTex)) rawTex[k] = v;
        }
      }
      const parent: string | undefined = cur.parent;
      if (!parent) break;
      const pk = stripNs(parent);
      if (pk.startsWith("builtin/")) break;
      cur = this.raw(pk);
    }
    if (!elements || elements.length === 0) return null;
    const textures: Record<string, string> = {};
    const translucent: Record<string, true> = {};
    for (const k of Object.keys(rawTex)) {
      const r = resolveTexRef(rawTex, k);
      if (r !== null) {
        textures[k] = r.key;
        if (r.translucent) translucent[k] = true;
      }
    }
    return { elements, textures, translucent };
  }
}

function resolveTexRef(
  raw: Record<string, TextureValue>,
  key: string,
): { key: string; translucent: boolean } | null {
  let v: TextureValue | undefined = raw[key];
  let translucent = false;
  for (let i = 0; i < 16 && v !== undefined; i++) {
    let s: string;
    if (typeof v === "string") s = v;
    else {
      if (v.force_translucent) translucent = true;
      s = v.sprite;
    }
    if (!s.startsWith("#")) return { key: textureKey(s), translucent };
    v = raw[s.slice(1)];
  }
  return null;
}

/** Resolve a face texture ("#side" or a direct id) against a resolved model's textures. */
export function faceTexture(model: ResolvedModel, ref: string): string | null {
  if (ref.startsWith("#")) return model.textures[ref.slice(1)] ?? null;
  return textureKey(ref);
}

/** Whether a face texture reference is flagged force_translucent. */
export function faceForceTranslucent(model: ResolvedModel, ref: string): boolean {
  return ref.startsWith("#") && !!model.translucent[ref.slice(1)];
}
