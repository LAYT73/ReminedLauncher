import type { BlockstateJson, BlockstateVariant, ModelRef, WhenClause } from "../model/types";

export interface ParsedState {
  /** name without namespace, e.g. "oak_stairs" */
  name: string;
  props: Record<string, string>;
}

/** "minecraft:oak_stairs[facing=east,half=bottom]" -> { name, props } */
export function parseBlockState(s: string): ParsedState {
  const br = s.indexOf("[");
  const full = br < 0 ? s : s.slice(0, br);
  const colon = full.indexOf(":");
  const name = colon < 0 ? full : full.slice(colon + 1);
  const props: Record<string, string> = {};
  if (br >= 0) {
    const inner = s.slice(br + 1, s.lastIndexOf("]") < 0 ? undefined : s.lastIndexOf("]"));
    for (const part of inner.split(",")) {
      const eq = part.indexOf("=");
      if (eq > 0) props[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return { name, props };
}

function toRef(v: BlockstateVariant): ModelRef {
  return {
    model: v.model,
    x: ((v.x ?? 0) % 360 + 360) % 360,
    y: ((v.y ?? 0) % 360 + 360) % 360,
    uvlock: !!v.uvlock,
  };
}

function pickFirst(v: BlockstateVariant | BlockstateVariant[]): BlockstateVariant | null {
  if (Array.isArray(v)) return v.length ? v[0] : null;
  return v;
}

function variantMatches(key: string, props: Record<string, string>): boolean {
  if (key === "" || key === "normal") return true;
  for (const cond of key.split(",")) {
    const eq = cond.indexOf("=");
    if (eq < 0) continue;
    if (props[cond.slice(0, eq)] !== cond.slice(eq + 1)) return false;
  }
  return true;
}

function conditionMatches(when: WhenClause, props: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(when)) {
    if (k === "OR") {
      if (!Array.isArray(v) || !v.some((c) => conditionMatches(c as WhenClause, props))) return false;
    } else if (k === "AND") {
      if (!Array.isArray(v) || !v.every((c) => conditionMatches(c as WhenClause, props))) return false;
    } else {
      const have = props[k];
      const alts = String(v).split("|");
      if (have === undefined || !alts.includes(have)) return false;
    }
  }
  return true;
}

/** Resolve a blockstate JSON into the list of models (with rotations) to render. */
export function resolveBlockstate(
  def: BlockstateJson | undefined,
  props: Record<string, string>,
): ModelRef[] {
  if (!def) return [];
  if (def.variants) {
    for (const [key, v] of Object.entries(def.variants)) {
      if (variantMatches(key, props)) {
        const pick = pickFirst(v);
        return pick ? [toRef(pick)] : [];
      }
    }
    return [];
  }
  if (def.multipart) {
    const out: ModelRef[] = [];
    for (const part of def.multipart) {
      if (part.when && !conditionMatches(part.when, props)) continue;
      const pick = pickFirst(part.apply);
      if (pick) out.push(toRef(pick));
    }
    return out;
  }
  return [];
}
