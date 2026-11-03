import type { AssetsBundle, ElementJson, FaceName, ResolvedModel } from "../model/types";
import type { AtlasLookup } from "./atlas";
import { MISSING_KEY } from "./atlas";
import { parseBlockState, resolveBlockstate } from "./blockstate";
import { entityExtraModelFor, entityModelFor } from "./entityModels";
import { faceForceTranslucent, faceTexture, ModelResolver } from "./models";
import { loadTintColors, tintColor, WHITE, type RGB, type TintColors } from "./tints";

/** Direction indices: 0 down, 1 up, 2 north, 3 south, 4 west, 5 east. */
export const DIR_NAMES: FaceName[] = ["down", "up", "north", "south", "west", "east"];
export const DIR_VEC: [number, number, number][] = [
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
];
export const DIR_SHADE = [0.5, 1, 0.8, 0.8, 0.6, 0.6];
export const DIR_OF: Record<string, number> = {
  down: 0,
  up: 1,
  north: 2,
  south: 3,
  west: 4,
  east: 5,
};

export const CLS_OPAQUE = 0;
export const CLS_CUTOUT = 1;
export const CLS_TRANSLUCENT = 2;

export interface ResolvedAssets {
  bundle: AssetsBundle;
  resolver: ModelResolver;
  tints: TintColors;
}

export async function createAssets(bundle: AssetsBundle): Promise<ResolvedAssets> {
  return {
    bundle,
    resolver: new ModelResolver(bundle.models),
    tints: await loadTintColors(bundle),
  };
}

/** Sync variant for tests / callers that already hold tint colours. */
export function createAssetsSync(bundle: AssetsBundle, tints: TintColors): ResolvedAssets {
  return { bundle, resolver: new ModelResolver(bundle.models), tints };
}

export interface BakedEntry {
  quadCount: number;
  /** 12 floats per quad (4 verts xyz, block-local 0..1), CCW from outside. */
  pos: Float32Array;
  /** 8 floats per quad: atlas uv per vertex. */
  uv: Float32Array;
  /** 3 floats per quad: tint x directional shade. */
  col: Float32Array;
  /** 3 floats per quad: face normal. */
  nrm: Float32Array;
  /** cull direction or -1 */
  cull: Int8Array;
  /** CLS_* */
  cls: Uint8Array;
  fullOpaque: boolean;
  /** neighbouring blocks of the same palette name cull this block's cullfaced sides (glass, ice...) */
  cullSame: boolean;
  /** 0 none, 1 water, 2 lava */
  fluid: 0 | 1 | 2;
  fluidLevel: number;
  skip: boolean;
}

export const SKIP_BLOCKS = new Set([
  "air",
  "cave_air",
  "void_air",
  "structure_void",
  "light",
  "barrier",
  "moving_piston",
]);

const IMPLICIT_WATER = new Set(["bubble_column", "seagrass", "tall_seagrass", "kelp", "kelp_plant"]);
const CULL_SAME_RE = /(^|_)glass$|^glass$|^tinted_glass$|(^|_)ice$|^slime_block$|^honey_block$/;

export interface EntryModel {
  model: ResolvedModel;
  x: number;
  y: number;
  uvlock: boolean;
  tint?: RGB;
}

/** The models (with rotations) rendered for one palette string. */
export function entryModels(state: string, assets: ResolvedAssets): EntryModel[] {
  const { name, props } = parseBlockState(state);
  const out: EntryModel[] = [];
  const override = entityModelFor(name, props);
  if (override) {
    const m = assets.resolver.resolveInline(override.model);
    if (m) out.push({ model: m, x: override.x ?? 0, y: override.y, uvlock: false, tint: override.tint });
    return out;
  }
  for (const ref of resolveBlockstate(assets.bundle.blockstates[name], props)) {
    const m = assets.resolver.get(ref.model);
    if (m) out.push({ model: m, x: ref.x, y: ref.y, uvlock: ref.uvlock });
  }
  const extra = entityExtraModelFor(name);
  if (extra) {
    const m = assets.resolver.resolveInline(extra.model);
    if (m) out.push({ model: m, x: extra.x ?? 0, y: extra.y, uvlock: false });
  }
  return out;
}

export function fluidOf(name: string, props: Record<string, string>): { kind: 0 | 1 | 2; level: number } {
  if (name === "water") return { kind: 1, level: parseInt(props.level ?? "0", 10) || 0 };
  if (name === "lava") return { kind: 2, level: parseInt(props.level ?? "0", 10) || 0 };
  if (IMPLICIT_WATER.has(name) || props.waterlogged === "true") return { kind: 1, level: 0 };
  return { kind: 0, level: 0 };
}

/** All texture keys needed to render this palette (feed to buildAtlas). */
export function collectTextureKeys(palette: string[], assets: ResolvedAssets): Set<string> {
  const keys = new Set<string>();
  for (const state of palette) {
    const { name, props } = parseBlockState(state);
    if (SKIP_BLOCKS.has(name)) continue;
    for (const em of entryModels(state, assets)) {
      for (const el of em.model.elements) {
        for (const f of Object.values(el.faces)) {
          if (!f) continue;
          const k = faceTexture(em.model, f.texture);
          if (k) keys.add(k);
        }
      }
    }
    const fl = fluidOf(name, props);
    if (fl.kind === 1) keys.add("block/water_still");
    if (fl.kind === 2) keys.add("block/lava_still");
  }
  return keys;
}

// ---------- rotation helpers ----------

type V3 = [number, number, number];

function rotAxis(p: V3, axis: "x" | "y" | "z", deg: number): V3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const [x, y, z] = p;
  switch (axis) {
    case "x":
      return [x, y * c - z * s, y * s + z * c];
    case "y":
      return [x * c + z * s, y, -x * s + z * c];
    default:
      return [x * c - y * s, x * s + y * c, z];
  }
}

/** Blockstate-style variant rotation: x first, then y; positive angles as in vanilla. */
function variantRotate(p: V3, x: number, y: number): V3 {
  let r = p;
  if (x) r = rotAxis(r, "x", -x);
  if (y) r = rotAxis(r, "y", -y);
  return r;
}

/** Nearest axis direction index for a vector. */
export function nearestDir(v: V3): number {
  let best = 0;
  let bd = -Infinity;
  for (let i = 0; i < 6; i++) {
    const d = v[0] * DIR_VEC[i][0] + v[1] * DIR_VEC[i][1] + v[2] * DIR_VEC[i][2];
    if (d > bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Face corners TL, BL, BR, TR as seen from outside, in 0..16 element space. */
function faceCorners(dir: number, f: V3, t: V3): V3[] {
  const [x1, y1, z1] = f;
  const [x2, y2, z2] = t;
  switch (dir) {
    case 0:
      return [[x1, y1, z2], [x1, y1, z1], [x2, y1, z1], [x2, y1, z2]];
    case 1:
      return [[x1, y2, z1], [x1, y2, z2], [x2, y2, z2], [x2, y2, z1]];
    case 2:
      return [[x2, y2, z1], [x2, y1, z1], [x1, y1, z1], [x1, y2, z1]];
    case 3:
      return [[x1, y2, z2], [x1, y1, z2], [x2, y1, z2], [x2, y2, z2]];
    case 4:
      return [[x1, y2, z1], [x1, y1, z1], [x1, y1, z2], [x1, y2, z2]];
    default:
      return [[x2, y2, z2], [x2, y1, z2], [x2, y1, z1], [x2, y2, z1]];
  }
}

/** Vanilla default uv rect (in 0..16) for a face from the element bounds. */
export function defaultUv(dir: number, f: V3, t: V3): [number, number, number, number] {
  const [x1, y1, z1] = f;
  const [x2, y2, z2] = t;
  switch (dir) {
    case 0:
      return [x1, 16 - z2, x2, 16 - z1];
    case 1:
      return [x1, z1, x2, z2];
    case 2:
      return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case 3:
      return [x1, 16 - y2, x2, 16 - y1];
    case 4:
      return [z1, 16 - y2, z2, 16 - y1];
    default:
      return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
  }
}

/** Corner uvs (TL, BL, BR, TR) for a uv rect and a face rotation (0/90/180/270). */
export function cornerUvs(uv: [number, number, number, number], rotation: number): number[] {
  const [u0, v0, u1, v1] = uv;
  const cu = [u0, u0, u1, u1];
  const cv = [v0, v1, v1, v0];
  const shift = (((rotation / 90) | 0) % 4 + 4) % 4;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + shift) % 4;
    out.push(cu[j], cv[j]);
  }
  return out;
}

/** uv (0..16) -> world point on the face plane of `dir` (inverse of the default uv projection). */
function uvToPlane(dir: number, u: number, v: number): V3 {
  switch (dir) {
    case 0:
      return [u, 0, 16 - v];
    case 1:
      return [u, 16, v];
    case 2:
      return [16 - u, 16 - v, 0];
    case 3:
      return [u, 16 - v, 16];
    case 4:
      return [0, 16 - v, u];
    default:
      return [16, 16 - v, 16 - u];
  }
}

function planeToUv(dir: number, p: V3): [number, number] {
  switch (dir) {
    case 0:
      return [p[0], 16 - p[2]];
    case 1:
      return [p[0], p[2]];
    case 2:
      return [16 - p[0], 16 - p[1]];
    case 3:
      return [p[0], 16 - p[1]];
    case 4:
      return [p[2], 16 - p[1]];
    default:
      return [16 - p[2], 16 - p[1]];
  }
}

/** uvlock: keep the texture fixed in world space while the face turns from `dir` to `newDir`. */
export function uvlockPoint(dir: number, newDir: number, x: number, y: number, u: number, v: number): [number, number] {
  const p = uvToPlane(dir, u, v);
  const c: V3 = [p[0] - 8, p[1] - 8, p[2] - 8];
  const r = variantRotate(c, x, y);
  return planeToUv(newDir, [r[0] + 8, r[1] + 8, r[2] + 8]);
}

// ---------- baking ----------

/** Vertex colours are authored in sRGB (vanilla multiplies in display space); store linear. */
export function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

class QuadSink {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  nrm: number[] = [];
  cull: number[] = [];
  cls: number[] = [];
}

function clsOf(c: string): number {
  return c === "opaque" ? CLS_OPAQUE : c === "cutout" ? CLS_CUTOUT : CLS_TRANSLUCENT;
}

function bakeModel(
  sink: QuadSink,
  em: EntryModel,
  name: string,
  props: Record<string, string>,
  assets: ResolvedAssets,
  atlas: AtlasLookup,
): { fullElement: boolean; fullOpaque: boolean; fullNonOpaque: boolean } {
  let fullElement = false;
  let fullOpaque = false;
  let fullNonOpaque = false;
  const rotated = em.x !== 0 || em.y !== 0;
  for (const el of em.model.elements as ElementJson[]) {
    const f = el.from;
    const t = el.to;
    const er = el.rotation;
    let scale: V3 | null = null;
    if (er && er.axis && er.rescale) {
      const s = 1 / Math.cos((Math.abs(er.angle ?? 0) * Math.PI) / 180);
      scale = er.axis === "x" ? [1, s, s] : er.axis === "y" ? [s, 1, s] : [s, s, 1];
    }
    const isFull =
      !er && f[0] === 0 && f[1] === 0 && f[2] === 0 && t[0] === 16 && t[1] === 16 && t[2] === 16;
    let allOpaque = true;
    let faceCount = 0;
    for (let d = 0; d < 6; d++) {
      const face = el.faces[DIR_NAMES[d]];
      if (!face) continue;
      faceCount++;
      const key = faceTexture(em.model, face.texture) ?? MISSING_KEY;
      const ent = atlas.get(key);
      const forced = faceForceTranslucent(em.model, face.texture);
      if (ent.cls !== "opaque" || forced) allOpaque = false;

      // vertices
      const corners = faceCorners(d, f, t);
      const wp: V3[] = [];
      for (const c of corners) {
        let p: V3 = c;
        if (er) {
          let q: V3 = [p[0] - er.origin[0], p[1] - er.origin[1], p[2] - er.origin[2]];
          if (scale) q = [q[0] * scale[0], q[1] * scale[1], q[2] * scale[2]];
          if (er.axis) q = rotAxis(q, er.axis, er.angle ?? 0);
          else {
            if (er.x) q = rotAxis(q, "x", er.x);
            if (er.y) q = rotAxis(q, "y", er.y);
            if (er.z) q = rotAxis(q, "z", er.z);
          }
          p = [q[0] + er.origin[0], q[1] + er.origin[1], q[2] + er.origin[2]];
        }
        if (rotated) {
          const r = variantRotate([p[0] - 8, p[1] - 8, p[2] - 8], em.x, em.y);
          p = [r[0] + 8, r[1] + 8, r[2] + 8];
        }
        wp.push([p[0] / 16, p[1] / 16, p[2] / 16]);
      }

      // uv
      const uvRect = face.uv ?? defaultUv(d, f, t);
      const cu = cornerUvs(uvRect, face.rotation ?? 0);
      const dirAfter = rotated
        ? nearestDir(variantRotate(DIR_VEC[d], em.x, em.y))
        : d;
      if (rotated && em.uvlock) {
        for (let i = 0; i < 4; i++) {
          const [nu, nv] = uvlockPoint(d, dirAfter, em.x, em.y, cu[i * 2], cu[i * 2 + 1]);
          cu[i * 2] = nu;
          cu[i * 2 + 1] = nv;
        }
      }
      const du = ent.u1 - ent.u0;
      const dv = ent.v1 - ent.v0;
      for (let i = 0; i < 4; i++) {
        sink.pos.push(wp[i][0], wp[i][1], wp[i][2]);
        sink.uv.push(ent.u0 + (cu[i * 2] / 16) * du, ent.v1 - (cu[i * 2 + 1] / 16) * dv);
      }

      // normal from geometry
      const ax = wp[1][0] - wp[0][0], ay = wp[1][1] - wp[0][1], az = wp[1][2] - wp[0][2];
      const bx = wp[2][0] - wp[1][0], by = wp[2][1] - wp[1][1], bz = wp[2][2] - wp[1][2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      sink.nrm.push(nx, ny, nz);

      // colour
      const shadeDir = nearestDir([nx, ny, nz]);
      const shade = el.shade === false ? 1 : DIR_SHADE[shadeDir];
      let tint: RGB = WHITE;
      if (face.tintindex !== undefined && face.tintindex >= 0) {
        tint = em.tint ?? tintColor(name, props, face.tintindex, assets.tints);
      }
      sink.col.push(toLinear(tint[0] * shade), toLinear(tint[1] * shade), toLinear(tint[2] * shade));

      // cull
      let cull = -1;
      if (face.cullface) {
        const cd = DIR_OF[face.cullface];
        if (cd !== undefined) cull = rotated ? nearestDir(variantRotate(DIR_VEC[cd], em.x, em.y)) : cd;
      }
      sink.cull.push(cull);
      sink.cls.push(forced ? CLS_TRANSLUCENT : clsOf(ent.cls));
    }
    if (isFull) {
      fullElement = true;
      if (faceCount === 6) {
        if (allOpaque) fullOpaque = true;
        else fullNonOpaque = true;
      }
    }
  }
  return { fullElement, fullOpaque, fullNonOpaque };
}

export function bakeEntry(state: string, assets: ResolvedAssets, atlas: AtlasLookup): BakedEntry {
  const { name, props } = parseBlockState(state);
  const skip = SKIP_BLOCKS.has(name);
  const fl = fluidOf(name, props);
  const sink = new QuadSink();
  let fullOpaque = false;
  let fullNonOpaque = false;
  if (!skip) {
    for (const em of entryModels(state, assets)) {
      const r = bakeModel(sink, em, name, props, assets, atlas);
      if (r.fullOpaque) fullOpaque = true;
      if (r.fullNonOpaque) fullNonOpaque = true;
    }
  }
  return {
    quadCount: sink.cls.length,
    pos: new Float32Array(sink.pos),
    uv: new Float32Array(sink.uv),
    col: new Float32Array(sink.col),
    nrm: new Float32Array(sink.nrm),
    cull: new Int8Array(sink.cull),
    cls: new Uint8Array(sink.cls),
    fullOpaque,
    cullSame: fullNonOpaque && CULL_SAME_RE.test(name),
    fluid: fl.kind,
    fluidLevel: fl.level,
    skip,
  };
}

