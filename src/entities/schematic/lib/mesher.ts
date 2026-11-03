import * as THREE from "three";
import type { DecodedSchematic } from "../model/types";
import { buildAtlas, type Atlas, type AtlasLookup } from "./atlas";
import {
  bakeEntry,
  collectTextureKeys,
  CLS_OPAQUE,
  CLS_TRANSLUCENT,
  DIR_SHADE,
  toLinear,
  type BakedEntry,
  type ResolvedAssets,
} from "./bake";
import { parseBlockState } from "./blockstate";
import { WATER_TINT } from "./tints";

export { createAssets, createAssetsSync, collectTextureKeys } from "./bake";
export type { ResolvedAssets, BakedEntry } from "./bake";

export interface LayerCaps {
  opaque: THREE.BufferGeometry | null;
  cutout: THREE.BufferGeometry | null;
  translucent: THREE.BufferGeometry | null;
}

export interface LayerGeometry {
  y: number;
  opaque: THREE.BufferGeometry | null;
  cutout: THREE.BufferGeometry | null;
  translucent: THREE.BufferGeometry | null;
  /**
   * Down faces that were culled only because of the block below (other Y layer).
   * LayerView shows them only when the layer below is hidden/ghost.
   */
  capsDown: LayerCaps | null;
  /** Up faces culled only because of the block above (other Y layer). */
  capsUp: LayerCaps | null;
}

export interface BuildProgress {
  /** layers finished */
  done: number;
  total: number;
}

export interface BuildOptions {
  schematic: DecodedSchematic;
  assets: ResolvedAssets;
  atlas: AtlasLookup;
  onProgress?: (p: BuildProgress) => void;
  signal?: AbortSignal;
  /** Render source fluid at full height instead of vanilla 8/9. Default false. */
  fluidSourceFull?: boolean;
  /** Max ms of synchronous work before yielding to the event loop. Default 16. */
  yieldMs?: number;
}

/** Atlas containing exactly the textures a schematic's palette needs. */
export function createAtlasFor(assets: ResolvedAssets, palette: string[]): Promise<Atlas> {
  return buildAtlas(assets.bundle, collectTextureKeys(palette, assets));
}

// ---------- geometry builder ----------

class Builder {
  pos = new Float32Array(1024 * 12);
  nrm = new Float32Array(1024 * 12);
  uv = new Float32Array(1024 * 8);
  col = new Uint8Array(1024 * 16);
  quads = 0;

  reset() {
    this.quads = 0;
  }

  private grow() {
    const n = this.pos.length * 2;
    const g = <T extends Float32Array | Uint8Array>(a: T, len: number): T => {
      const b = new (a.constructor as new (n: number) => T)(len);
      b.set(a);
      return b;
    };
    this.pos = g(this.pos, n);
    this.nrm = g(this.nrm, n);
    this.uv = g(this.uv, (n / 12) * 8);
    this.col = g(this.col, (n / 12) * 16);
  }

  /** Append a baked quad translated to a block position. */
  addBaked(e: BakedEntry, q: number, ox: number, oy: number, oz: number) {
    if ((this.quads + 1) * 12 > this.pos.length) this.grow();
    const i = this.quads++;
    const p = i * 12;
    const s = q * 12;
    for (let k = 0; k < 12; k += 3) {
      this.pos[p + k] = e.pos[s + k] + ox;
      this.pos[p + k + 1] = e.pos[s + k + 1] + oy;
      this.pos[p + k + 2] = e.pos[s + k + 2] + oz;
      this.nrm[p + k] = e.nrm[q * 3];
      this.nrm[p + k + 1] = e.nrm[q * 3 + 1];
      this.nrm[p + k + 2] = e.nrm[q * 3 + 2];
    }
    const u = i * 8;
    const us = q * 8;
    for (let k = 0; k < 8; k++) this.uv[u + k] = e.uv[us + k];
    const r = Math.round(e.col[q * 3] * 255);
    const g = Math.round(e.col[q * 3 + 1] * 255);
    const b = Math.round(e.col[q * 3 + 2] * 255);
    const c = i * 16;
    for (let k = 0; k < 4; k++) {
      this.col[c + k * 4] = r;
      this.col[c + k * 4 + 1] = g;
      this.col[c + k * 4 + 2] = b;
      this.col[c + k * 4 + 3] = 255;
    }
  }

  /** Append an axis-aligned quad given 4 corners (TL, BL, BR, TR). */
  addRaw(
    c: ArrayLike<number>,
    nx: number,
    ny: number,
    nz: number,
    uv: ArrayLike<number>,
    r: number,
    g: number,
    b: number,
    a: number,
  ) {
    if ((this.quads + 1) * 12 > this.pos.length) this.grow();
    const i = this.quads++;
    const p = i * 12;
    for (let k = 0; k < 12; k++) this.pos[p + k] = c[k];
    for (let k = 0; k < 12; k += 3) {
      this.nrm[p + k] = nx;
      this.nrm[p + k + 1] = ny;
      this.nrm[p + k + 2] = nz;
    }
    for (let k = 0; k < 8; k++) this.uv[i * 8 + k] = uv[k];
    const cc = i * 16;
    for (let k = 0; k < 4; k++) {
      this.col[cc + k * 4] = r;
      this.col[cc + k * 4 + 1] = g;
      this.col[cc + k * 4 + 2] = b;
      this.col[cc + k * 4 + 3] = a;
    }
  }

  toGeometry(): THREE.BufferGeometry | null {
    const n = this.quads;
    if (n === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos.slice(0, n * 12), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(this.nrm.slice(0, n * 12), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(this.uv.slice(0, n * 8), 2));
    g.setAttribute("color", new THREE.BufferAttribute(this.col.slice(0, n * 16), 4, true));
    const idx = new Uint32Array(n * 6);
    for (let q = 0, v = 0, k = 0; q < n; q++, v += 4, k += 6) {
      idx[k] = v;
      idx[k + 1] = v + 1;
      idx[k + 2] = v + 2;
      idx[k + 3] = v;
      idx[k + 4] = v + 2;
      idx[k + 5] = v + 3;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- fluids ----------

const FLUID_CORNERS: Record<number, (x: number, y: number, z: number, h: number) => number[]> = {
  // down
  0: (x, y, z) => [x, y, z + 1, x, y, z, x + 1, y, z, x + 1, y, z + 1],
  // up
  1: (x, y, z, h) => [x, y + h, z, x, y + h, z + 1, x + 1, y + h, z + 1, x + 1, y + h, z],
  // north
  2: (x, y, z, h) => [x + 1, y + h, z, x + 1, y, z, x, y, z, x, y + h, z],
  // south
  3: (x, y, z, h) => [x, y + h, z + 1, x, y, z + 1, x + 1, y, z + 1, x + 1, y + h, z + 1],
  // west
  4: (x, y, z, h) => [x, y + h, z, x, y, z, x, y, z + 1, x, y + h, z + 1],
  // east
  5: (x, y, z, h) => [x + 1, y + h, z + 1, x + 1, y, z + 1, x + 1, y, z, x + 1, y + h, z],
};
const NEIGH: [number, number, number][] = [
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
];

const WATER_ALPHA = 0.75;

// ---------- main entry ----------

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== "undefined") {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Meshes a schematic layer by layer (y = 0 first). Yields to the event loop about
 * every `yieldMs` ms so the UI stays responsive. Block (x,y,z) occupies the unit
 * cube [x,x+1]x[y,y+1]x[z,z+1] in world space.
 */
export async function* buildLayersIter(opts: BuildOptions): AsyncGenerator<LayerGeometry> {
  const { schematic, assets, atlas } = opts;
  const [sx, sy, sz] = schematic.size;
  const blocks = schematic.blocks;
  const palette = schematic.palette;
  const yieldMs = opts.yieldMs ?? 16;

  const entries: BakedEntry[] = palette.map((s) => bakeEntry(s, assets, atlas));
  const nameIds = new Int32Array(palette.length);
  const nameMap = new Map<string, number>();
  palette.forEach((s, i) => {
    const n = parseBlockState(s).name;
    let id = nameMap.get(n);
    if (id === undefined) nameMap.set(n, (id = nameMap.size));
    nameIds[i] = id;
  });
  const waterEnt = atlas.get("block/water_still");
  const lavaEnt = atlas.get("block/lava_still");
  const waterRgb = [toLinear(WATER_TINT[0]), toLinear(WATER_TINT[1]), toLinear(WATER_TINT[2])];

  // [0..2] main (opaque, cutout, translucent), [3..5] capsDown, [6..8] capsUp
  const builders = Array.from({ length: 9 }, () => new Builder());
  const CAPS_DOWN = 3;
  const CAPS_UP = 6;
  const layerStride = sx * sz;
  let last = performance.now();
  const nb = new Int32Array(6);

  for (let y = 0; y < sy; y++) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    for (const b of builders) b.reset();
    const yBase = y * layerStride;

    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const id = blocks[yBase + z * sx + x];
        if (id === 0) continue;
        const e = entries[id];
        if (!e || e.skip) continue;

        // neighbour palette ids (-1 outside the schematic)
        nb[0] = y > 0 ? blocks[yBase - layerStride + z * sx + x] : -1;
        nb[1] = y < sy - 1 ? blocks[yBase + layerStride + z * sx + x] : -1;
        nb[2] = z > 0 ? blocks[yBase + (z - 1) * sx + x] : -1;
        nb[3] = z < sz - 1 ? blocks[yBase + (z + 1) * sx + x] : -1;
        nb[4] = x > 0 ? blocks[yBase + z * sx + x - 1] : -1;
        nb[5] = x < sx - 1 ? blocks[yBase + z * sx + x + 1] : -1;

        const nq = e.quadCount;
        for (let q = 0; q < nq; q++) {
          const c = e.cull[q];
          let off = 0;
          if (c >= 0) {
            const n = nb[c];
            if (n >= 0 && (entries[n].fullOpaque || (e.cullSame && nameIds[n] === nameIds[id]))) {
              if (c > 1) continue;
              // Culled only by a vertical neighbour (another layer): keep as a cap.
              off = c === 0 ? CAPS_DOWN : CAPS_UP;
            }
          }
          builders[off + e.cls[q]].addBaked(e, q, x, y, z);
        }

        if (e.fluid !== 0) {
          const kind = e.fluid;
          const sameAbove = nb[1] >= 0 && entries[nb[1]].fluid === kind;
          let h: number;
          if (sameAbove || e.fluidLevel >= 8) h = 1;
          else if (e.fluidLevel === 0) h = opts.fluidSourceFull ? 1 : 8 / 9;
          else h = (8 - (e.fluidLevel % 8)) / 9;
          const ent = kind === 1 ? waterEnt : lavaEnt;
          const fcls = kind === 1 ? CLS_TRANSLUCENT : ent.cls === "opaque" ? CLS_OPAQUE : ent.cls === "cutout" ? 1 : CLS_TRANSLUCENT;
          for (let d = 0; d < 6; d++) {
            const n = nb[d];
            let off = 0;
            if (n >= 0) {
              const ne = entries[n];
              if (ne.fluid === kind || ne.fullOpaque) {
                if (d > 1) continue;
                off = d === 0 ? CAPS_DOWN : CAPS_UP;
              }
            }
            const bld = builders[off + fcls];
            const corners = FLUID_CORNERS[d](x, y, z, h);
            const vmax = d >= 2 ? h * 16 : 16;
            const dv = ent.v1 - ent.v0;
            const vv = vmax / 16;
            const uv =
              d >= 2
                ? [ent.u0, ent.v1, ent.u0, ent.v1 - vv * dv, ent.u1, ent.v1 - vv * dv, ent.u1, ent.v1]
                : [ent.u0, ent.v1, ent.u0, ent.v0, ent.u1, ent.v0, ent.u1, ent.v1];
            const shade = toLinear(DIR_SHADE[d]);
            const rgb = kind === 1 ? waterRgb : [1, 1, 1];
            const a = kind === 1 && ent.cls === "opaque" ? Math.round(WATER_ALPHA * 255) : 255;
            bld.addRaw(
              corners,
              NEIGH[d][0],
              NEIGH[d][1],
              NEIGH[d][2],
              uv,
              Math.round(rgb[0] * shade * 255),
              Math.round(rgb[1] * shade * 255),
              Math.round(rgb[2] * shade * 255),
              a,
            );
          }
        }
      }
      if (performance.now() - last > yieldMs) {
        await nextTick();
        last = performance.now();
        if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
      }
    }

    const caps = (o: number): LayerCaps | null => {
      const c = {
        opaque: builders[o].toGeometry(),
        cutout: builders[o + 1].toGeometry(),
        translucent: builders[o + 2].toGeometry(),
      };
      return c.opaque || c.cutout || c.translucent ? c : null;
    };
    yield {
      y,
      opaque: builders[0].toGeometry(),
      cutout: builders[1].toGeometry(),
      translucent: builders[2].toGeometry(),
      capsDown: caps(CAPS_DOWN),
      capsUp: caps(CAPS_UP),
    };
    opts.onProgress?.({ done: y + 1, total: sy });
    if (performance.now() - last > yieldMs) {
      await nextTick();
      last = performance.now();
    }
  }
}

/** Collects buildLayersIter into an array indexed by y. */
export async function buildLayers(opts: BuildOptions): Promise<LayerGeometry[]> {
  const out: LayerGeometry[] = [];
  try {
    for await (const l of buildLayersIter(opts)) out.push(l);
  } catch (err) {
    for (const l of out) {
      l.opaque?.dispose();
      l.cutout?.dispose();
      l.translucent?.dispose();
      for (const c of [l.capsDown, l.capsUp]) {
        c?.opaque?.dispose();
        c?.cutout?.dispose();
        c?.translucent?.dispose();
      }
    }
    throw err;
  }
  return out;
}

// ---------- materials ----------

export type LayerStyle = "normal" | "dimmed" | "ghost";

export interface MaterialSet {
  opaque: THREE.MeshBasicMaterial;
  cutout: THREE.MeshBasicMaterial;
  translucent: THREE.MeshBasicMaterial;
}

export interface SchematicMaterials {
  normal: MaterialSet;
  dimmed: MaterialSet;
  ghost: MaterialSet;
  dispose(): void;
}

function desaturate(m: THREE.MeshBasicMaterial, amount: number) {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, ${amount.toFixed(3)});`,
    );
  };
  m.customProgramCacheKey = () => `schem-desat-${amount}`;
}

function makeSet(map: THREE.Texture, style: LayerStyle): MaterialSet {
  const base = { map, vertexColors: true } as const;
  const opaque = new THREE.MeshBasicMaterial({ ...base });
  const cutout = new THREE.MeshBasicMaterial({ ...base, alphaTest: 0.5 });
  const translucent = new THREE.MeshBasicMaterial({
    ...base,
    transparent: true,
    depthWrite: false,
  });
  const set = { opaque, cutout, translucent };
  if (style === "dimmed") {
    for (const m of Object.values(set)) {
      m.color.setRGB(0.5, 0.52, 0.56);
      desaturate(m, 0.55);
    }
  } else if (style === "ghost") {
    for (const m of Object.values(set)) {
      m.color.setRGB(0.7, 0.75, 0.85);
      desaturate(m, 0.4);
      m.transparent = true;
      m.opacity = 0.08;
      m.depthWrite = false;
    }
    cutout.alphaTest = 0.5;
  }
  return set;
}

/** Creates the shared material sets (normal / dimmed / ghost) around one atlas texture. */
export function createMaterials(atlasTexture: THREE.Texture): SchematicMaterials {
  const normal = makeSet(atlasTexture, "normal");
  const dimmed = makeSet(atlasTexture, "dimmed");
  const ghost = makeSet(atlasTexture, "ghost");
  return {
    normal,
    dimmed,
    ghost,
    dispose() {
      for (const s of [normal, dimmed, ghost]) {
        s.opaque.dispose();
        s.cutout.dispose();
        s.translucent.dispose();
      }
    },
  };
}
