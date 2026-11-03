// Self-check for src/entities/schematic pure logic against a real client jar.
// Run: node scripts/check-schematic.mjs [path/to/client.jar]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBlockState, resolveBlockstate } from "../src/entities/schematic/lib/blockstate";
import { ModelResolver } from "../src/entities/schematic/lib/models";
import {
  bakeEntry,
  collectTextureKeys,
  cornerUvs,
  createAssetsSync,
  defaultUv,
  uvlockPoint,
} from "../src/entities/schematic/lib/bake";
import { chestElements } from "../src/entities/schematic/lib/entityModels";
import { materialItems } from "../src/entities/schematic/lib/materials";
import * as THREE from "three";
import { DIR_VEC } from "../src/entities/schematic/lib/bake";
import { LayerView, type LayerState } from "../src/entities/schematic/lib/layerView";
import { buildLayers, createMaterials, type LayerGeometry } from "../src/entities/schematic/lib/mesher";
import { DEFAULT_TINTS } from "../src/entities/schematic/lib/tints";
import type { AssetsBundle, DecodedSchematic } from "../src/entities/schematic/model/types";

const jar = process.argv[2] ?? "../packs/vanillapro/VanillaPro.jar";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schem-check-"));
execFileSync("unzip", ["-qo", jar, "assets/minecraft/blockstates/*", "assets/minecraft/models/block/*", "assets/minecraft/textures/block/*", "-d", dir]);
const R = path.join(dir, "assets/minecraft");
const readAll = (sub: string, prefix: string) => {
  const out: Record<string, any> = {};
  for (const f of fs.readdirSync(path.join(R, sub))) {
    if (f.endsWith(".json")) out[prefix + f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(R, sub, f), "utf8"));
  }
  return out;
};
const textureFiles = new Set(fs.readdirSync(path.join(R, "textures/block")).filter((f) => f.endsWith(".png")).map((f) => "block/" + f.slice(0, -4)));
const bundle: AssetsBundle = {
  version: "test",
  blockstates: readAll("blockstates", ""),
  models: readAll("models/block", "block/"),
  textures: {},
  animated: [],
  colormaps: { grass: "", foliage: "" },
  names: {},
};
const assets = createAssetsSync(bundle, DEFAULT_TINTS);
const atlas = {
  get: (k: string) => ({ u0: 0, v0: 0, u1: 1, v1: 1, w: 16, h: 16, cls: /glass|water|ice|honey|slime/.test(k) ? ("translucent" as const) : /leaves|grass_block_side_overlay|fern|torch|rail|vine/.test(k) ? ("cutout" as const) : ("opaque" as const) }),
};
let passed = 0;
const pending: Promise<void>[] = [];
const t = (name: string, fn: () => void | Promise<void>) => {
  const fail = (e: unknown) => {
    console.error("FAIL", name, e);
    process.exitCode = 1;
  };
  try {
    const r = fn();
    if (r) pending.push(r.then(() => void passed++, fail));
    else passed++;
  } catch (e) {
    fail(e);
  }
};

// ---- blockstate parsing / matching
t("parse", () => {
  const p = parseBlockState("minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]");
  assert.equal(p.name, "oak_stairs");
  assert.equal(p.props.facing, "east");
  assert.deepEqual(parseBlockState("minecraft:air"), { name: "air", props: {} });
});
t("variants", () => {
  const r = resolveBlockstate(bundle.blockstates.oak_stairs, parseBlockState("minecraft:oak_stairs[facing=east,half=bottom,shape=inner_left,waterlogged=false]").props);
  assert.equal(r.length, 1);
  assert.equal(r[0].model, "minecraft:block/oak_stairs_inner");
  assert.equal(r[0].y, 270);
  assert.equal(r[0].uvlock, true);
  assert.equal(resolveBlockstate({ variants: { "": { model: "a" } } }, {}).length, 1);
  assert.equal(resolveBlockstate({ variants: { "": [{ model: "a" }, { model: "b" }] } }, {})[0].model, "a");
});
t("multipart fence", () => {
  const props = parseBlockState("minecraft:oak_fence[east=true,north=true,south=false,waterlogged=false,west=false]").props;
  const r = resolveBlockstate(bundle.blockstates.oak_fence, props);
  assert.deepEqual(r.map((x) => [x.model.split("/")[1], x.y]), [["oak_fence_post", 0], ["oak_fence_side", 0], ["oak_fence_side", 90]]);
});
t("multipart OR/AND and | alternatives", () => {
  const def = {
    multipart: [
      { apply: { model: "base" } },
      { when: { OR: [{ a: "1" }, { b: "x|y" }] }, apply: { model: "or" } },
      { when: { AND: [{ a: "1" }, { b: "y" }] }, apply: { model: "and" } },
    ],
  };
  assert.deepEqual(resolveBlockstate(def, { a: "0", b: "z" }).map((r) => r.model), ["base"]);
  assert.deepEqual(resolveBlockstate(def, { a: "0", b: "y" }).map((r) => r.model), ["base", "or"]);
  assert.deepEqual(resolveBlockstate(def, { a: "1", b: "y" }).map((r) => r.model), ["base", "or", "and"]);
});

// ---- models
t("model parent/texture resolution", () => {
  const m = assets.resolver.get("minecraft:block/oak_stairs")!;
  assert.ok(m.elements.length >= 2);
  assert.equal(m.textures.side, "block/oak_planks");
  assert.equal(m.textures.particle, "block/oak_planks");
  assert.equal(assets.resolver.get("block/water"), null);
  assert.equal(assets.resolver.get("block/block"), null);
  const r = new ModelResolver({ "block/a": { textures: { x: "#y", y: "minecraft:block/z" }, elements: [{ from: [0, 0, 0], to: [1, 1, 1], faces: {} }] }, "block/b": { parent: "block/a", textures: { y: "block/w" } } });
  assert.equal(r.get("block/b")!.textures.x, "block/w");
});

// ---- uv
t("default uv + rotation", () => {
  assert.deepEqual(defaultUv(1, [0, 0, 0], [16, 8, 16]), [0, 0, 16, 16]);
  assert.deepEqual(defaultUv(3, [0, 0, 0], [16, 8, 16]), [0, 8, 16, 16]);
  assert.deepEqual(cornerUvs([0, 0, 16, 16], 0), [0, 0, 0, 16, 16, 16, 16, 0]);
  assert.deepEqual(cornerUvs([0, 0, 16, 16], 90), [0, 16, 16, 16, 16, 0, 0, 0]);
});
t("uvlock keeps up-face texture world-aligned under y rotation", () => {
  // up face, y=90: a vertex uv (u,v) -> the same texture point as the world-projected uv
  const [u, v] = uvlockPoint(1, 1, 0, 90, 0, 0);
  assert.deepEqual([Math.round(u), Math.round(v)], [16, 0]);
  // identity rotation
  assert.deepEqual(uvlockPoint(1, 1, 0, 0, 3, 5).map(Math.round), [3, 5]);
});

// ---- bake
const A = (s: string) => bakeEntry(s, assets, atlas);
t("full cube", () => {
  const e = A("minecraft:stone");
  assert.equal(e.quadCount, 6);
  assert.equal(e.fullOpaque, true);
  assert.equal(A("minecraft:glass").fullOpaque, false);
  assert.equal(A("minecraft:glass").cullSame, true);
  assert.equal(A("minecraft:oak_leaves[distance=1,persistent=false,waterlogged=false]").fullOpaque, false);
  assert.equal(A("minecraft:grass_block[snowy=false]").fullOpaque, true);
});
t("bake outward normals match face dir", () => {
  const e = A("minecraft:stone");
  const want = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  for (let q = 0; q < 6; q++) {
    const n = [e.nrm[q * 3], e.nrm[q * 3 + 1], e.nrm[q * 3 + 2]].map((x) => Math.round(x) + 0);
    const c = e.cull[q];
    assert.deepEqual(n.map((x) => x || 0), want[c]);
  }
});
t("stairs rotation moves cullfaces", () => {
  const e = A("minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]");
  assert.ok(e.quadCount > 6);
  // bottom full slab: down face must still cull down (index 0)
  assert.ok(Array.from(e.cull).includes(0));
  const top = A("minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]");
  assert.ok(Array.from(top.cull).includes(1));
});
t("uvlock stairs: up/down faces keep world-aligned uvs for every facing/half", () => {
  for (const facing of ["north", "south", "east", "west"]) {
    for (const half of ["bottom", "top"]) {
      for (const shape of ["straight", "inner_left", "outer_right"]) {
        const e = A(`minecraft:oak_stairs[facing=${facing},half=${half},shape=${shape},waterlogged=false]`);
        for (let q = 0; q < e.quadCount; q++) {
          const ny = Math.round(e.nrm[q * 3 + 1]);
          if (ny === 0) continue;
          for (let i = 0; i < 4; i++) {
            const x = e.pos[q * 12 + i * 3];
            const z = e.pos[q * 12 + i * 3 + 2];
            const u = e.uv[q * 8 + i * 2] * 16;
            const v = (1 - e.uv[q * 8 + i * 2 + 1]) * 16;
            const wantV = ny > 0 ? z * 16 : 16 - z * 16;
            assert.ok(Math.abs(u - x * 16) < 1e-3 && Math.abs(v - wantV) < 1e-3, `${facing}/${half}/${shape} q${q} ny${ny} uv=${u},${v} pos=${x},${z}`);
          }
        }
      }
    }
  }
});
t("element rotation (torch) is tilted", () => {
  const e = A("minecraft:wall_torch[facing=east]");
  assert.ok(e.quadCount > 0);
  let tilted = false;
  for (let q = 0; q < e.quadCount; q++) if (Math.abs(e.nrm[q * 3]) > 0.1 && Math.abs(e.nrm[q * 3 + 1]) > 0.1) tilted = true;
  assert.ok(tilted);
});
t("entity models bake", () => {
  for (const s of [
    "minecraft:chest[facing=north,type=single,waterlogged=false]",
    "minecraft:chest[facing=east,type=left,waterlogged=false]",
    "minecraft:ender_chest[facing=south,waterlogged=false]",
    "minecraft:red_shulker_box[facing=up]",
    "minecraft:white_banner[rotation=3]",
    "minecraft:blue_wall_banner[facing=west]",
    "minecraft:skeleton_skull[powered=false,rotation=5]",
    "minecraft:player_wall_head[facing=north]",
    "minecraft:decorated_pot[cracked=false,facing=north,waterlogged=false]",
    "minecraft:conduit[waterlogged=true]",
    "minecraft:bell[attachment=floor,facing=north,powered=false]",
  ]) assert.ok(A(s).quadCount > 0, s);
});
t("every blockstate bakes without error; report missing textures", () => {
  const states: string[] = [];
  for (const [name, def] of Object.entries(bundle.blockstates)) {
    if (def.variants) for (const key of Object.keys(def.variants)) states.push(`minecraft:${name}${key ? `[${key}]` : ""}`);
    else states.push(`minecraft:${name}`);
  }
  let quads = 0;
  for (const s of states) quads += A(s).quadCount;
  const keys = collectTextureKeys(states, assets);
  const missing = [...keys].filter((k) => k.startsWith("block/") && !textureFiles.has(k));
  console.log(`  ${states.length} states, ${quads} quads, ${keys.size} textures, ${missing.length} missing block textures`, missing.slice(0, 12));
});


// ---- exhaustive culling checks
type Quad = { c: [number, number, number]; n: [number, number, number]; main: boolean };
const quadsOf = (geo: THREE.BufferGeometry | null | undefined, main: boolean, out: Quad[] = []): Quad[] => {
  if (!geo) return out;
  const p = geo.getAttribute("position");
  const nr = geo.getAttribute("normal");
  for (let q = 0; q < p.count / 4; q++) {
    const c: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 4; i++) {
      c[0] += p.getX(q * 4 + i) / 4;
      c[1] += p.getY(q * 4 + i) / 4;
      c[2] += p.getZ(q * 4 + i) / 4;
    }
    out.push({ c, n: [nr.getX(q * 4), nr.getY(q * 4), nr.getZ(q * 4)], main });
  }
  return out;
};
const layerQuads = (l: LayerGeometry, out: Quad[] = []) => {
  for (const g of [l.opaque, l.cutout, l.translucent]) quadsOf(g, true, out);
  for (const caps of [l.capsUp, l.capsDown]) if (caps) for (const g of [caps.opaque, caps.cutout, caps.translucent]) quadsOf(g, false, out);
  return out;
};
const dirOfNormal = (n: number[]) => DIR_VEC.findIndex((v) => Math.abs(v[0] - n[0]) < 1e-3 && Math.abs(v[1] - n[1]) < 1e-3 && Math.abs(v[2] - n[2]) < 1e-3);
const allStates: string[] = [];
for (const [name, def] of Object.entries(bundle.blockstates)) {
  if (def.variants) for (const key of Object.keys(def.variants)) allStates.push(`minecraft:${name}${key ? `[${key}]` : ""}`);
  else allStates.push(`minecraft:${name}`);
}
/** Build 6 cells (one per open direction) of 3x3x3 stone with `state` in the centre; returns centre-block quads per open direction. */
async function probe(state: string, openDirs: number[]): Promise<Quad[][]> {
  const cells = openDirs.length;
  const size: [number, number, number] = [cells * 4 - 1, 3, 3];
  const blocks = new Uint16Array(size[0] * 9);
  const ids = new Map<number, number>();
  for (let k = 0; k < cells; k++) {
    for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) blocks[x + k * 4 + z * size[0] + y * size[0] * 3] = 1;
    const ctr = 1 + k * 4 + 1 * size[0] + 1 * size[0] * 3;
    blocks[ctr] = 2;
    const v = DIR_VEC[openDirs[k]];
    blocks[ctr + v[0] + v[2] * size[0] + v[1] * size[0] * 3] = 0;
    ids.set(k, ctr);
  }
  const s: DecodedSchematic = { id: "p", name: "p", size, palette: ["minecraft:air", "minecraft:stone", state], blocks };
  const layers = await buildLayers({ schematic: s, assets, atlas, yieldMs: Infinity });
  const all: Quad[] = [];
  for (const l of layers) layerQuads(l, all);
  // everything except the surrounding stone: subtract the same schematic with the centre left empty
  base ??= await (async () => {
    const b2 = new Uint16Array(blocks);
    for (let k = 0; k < cells; k++) b2[1 + k * 4 + size[0] + size[0] * 3] = 0;
    const ls = await buildLayers({ schematic: { ...s, blocks: b2 }, assets, atlas, yieldMs: Infinity });
    const m = new Map<string, number>();
    for (const l of ls) for (const q of layerQuads(l)) m.set(key(q), (m.get(key(q)) ?? 0) + 1);
    return m;
  })();
  const left = new Map(base);
  const mine: Quad[] = [];
  for (const q of all) {
    const k = key(q);
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else mine.push(q);
  }
  const out: Quad[][] = [];
  for (let k = 0; k < cells; k++) {
    const cx = 1 + k * 4;
    out.push(mine.filter((q) => q.c[0] > cx - 1.5 && q.c[0] < cx + 2.5 && q.c[2] > -0.5 && q.c[2] < 3.5 && q.c[1] > -0.5 && q.c[1] < 3.5));
  }
  return out;
}
let base: Map<string, number> | undefined;
const key = (q: Quad) => q.c.map((x) => x.toFixed(4)).join(",") + "|" + q.n.map((x) => x.toFixed(2)).join(",");
const xc = (cell: number) => 1 + cell * 4;
const ALL_DIRS = [0, 1, 2, 3, 4, 5];
const fluidFree = (s: string) => {
  const e = A(s);
  return e.fluid === 0 && !e.skip ? e : null;
};
t("every baked cullface that lies on a block boundary points the same way as its face normal (rotation of cull dirs)", () => {
  const bad: string[] = [];
  for (const s of allStates) {
    const e = fluidFree(s);
    if (!e) continue;
    for (let q = 0; q < e.quadCount; q++) {
      const c = e.cull[q];
      if (c < 0) continue;
      const v = DIR_VEC[c];
      const want = v[0] + v[1] + v[2] > 0 ? 1 : 0;
      let onBoundary = true;
      for (let i = 0; i < 4; i++) {
        const d = Math.abs(v[0]) * e.pos[q * 12 + i * 3] + Math.abs(v[1]) * e.pos[q * 12 + i * 3 + 1] + Math.abs(v[2]) * e.pos[q * 12 + i * 3 + 2];
        if (Math.abs(d - want) > 1e-5) onBoundary = false;
      }
      const nd = dirOfNormal([e.nrm[q * 3], e.nrm[q * 3 + 1], e.nrm[q * 3 + 2]]);
      // inset faces (hopper bowl, cauldron inside...) carry vanilla cullfaces without lying on the boundary
      if (onBoundary && nd !== c) bad.push(`${s} q${q}: cull=${c} normal=${nd}`);
    }
  }
  assert.equal(bad.length, 0, `cull dir differs from face normal:\n${bad.slice(0, 20).join("\n")}`);
});
t("(a) every full-opaque blockstate variant shows a face toward each open direction and none toward stone", async () => {
  const bad: string[] = [];
  let n = 0;
  for (const s of allStates) {
    const e = fluidFree(s);
    if (!e || !e.fullOpaque) continue;
    n++;
    const res = await probe(s, ALL_DIRS);
    for (let d = 0; d < 6; d++) {
      const quads = res[d];
      const open = quads.filter((q) => dirOfNormal(q.n) === d);
      if (open.length === 0) bad.push(`${s}: no face toward open dir ${d}`);
      for (const q of quads) {
        const nd = dirOfNormal(q.n);
        // only outer faces count: vanilla has uncullable inner faces (vault, spawner, ...)
        const onOuter = Math.abs(q.n[0] * (q.c[0] - 1 - 0.5 - 4 * d) * 0 + (Math.abs(q.n[0] * (q.c[0] - xc(d) - 0.5) + q.n[1] * (q.c[1] - 1.5) + q.n[2] * (q.c[2] - 1.5)) - 0.5)) < 1e-5;
        if (nd >= 0 && nd !== d && q.main && onOuter) bad.push(`${s}: main face toward stone dir ${nd} (open ${d})`);
      }
    }
  }
  console.log(`  ${n} full-opaque variants probed`);
  assert.ok(n > 500);
  assert.equal(bad.length, 0, bad.slice(0, 20).join("\n"));
});
t("(b) non-full variants: faces with cullface toward an empty direction are never culled", async () => {
  const bad: string[] = [];
  let n = 0;
  for (const s of allStates) {
    const e = fluidFree(s);
    if (!e || e.fullOpaque || e.quadCount === 0) continue;
    n++;
    const res = await probe(s, ALL_DIRS);
    for (let d = 0; d < 6; d++) {
      const quads = res[d];
      let wantMain = 0;
      let wantAll = 0;
      for (let q = 0; q < e.quadCount; q++) {
        const c = e.cull[q];
        if (c < 0 || c === d) {
          wantMain++;
          wantAll++;
        } else if (c < 2) wantAll++;
      }
      const gotMain = quads.filter((q) => q.main).length;
      if (gotMain !== wantMain) bad.push(`${s}: open ${d}: main quads ${gotMain} != ${wantMain}`);
      if (quads.length !== wantAll) bad.push(`${s}: open ${d}: total quads ${quads.length} != ${wantAll}`);
    }
  }
  console.log(`  ${n} non-full variants probed`);
  assert.equal(bad.length, 0, bad.slice(0, 20).join("\n"));
});
t("(c) LayerView: no holes for any layer-state combination or transition order", async () => {
  const size: [number, number, number] = [1, 3, 1];
  const s: DecodedSchematic = { id: "c", name: "c", size, palette: ["minecraft:air", "minecraft:white_terracotta"], blocks: new Uint16Array([1, 1, 1]) };
  const layers = await buildLayers({ schematic: s, assets, atlas, yieldMs: Infinity });
  const mats = createMaterials(new THREE.Texture());
  const STATES: LayerState[] = ["normal", "dimmed", "ghost", "hidden"];
  const visibleQuads = (v: LayerView) => {
    const out: { y: number; d: number }[] = [];
    for (const g of v.group.children) {
      if (!g.visible) continue;
      for (const m of g.children as THREE.Mesh[]) {
        if (!m.visible) continue;
        for (const q of quadsOf(m.geometry, true)) out.push({ y: Math.round(q.c[1] - 0.5 * q.n[1] - 0.5), d: dirOfNormal(q.n) });
      }
    }
    return out;
  };
  const check = (v: LayerView, st: LayerState[], label: string) => {
    const vis = visibleQuads(v);
    const has = (y: number, d: number) => vis.filter((q) => q.y === y && q.d === d).length;
    const solid = (y: number) => st[y] === "normal" || st[y] === "dimmed";
    for (let y = 0; y < 3; y++) {
      for (let d = 0; d < 6; d++) {
        const exp = st[y] === "hidden" ? 0 : d === 0 ? (solid(y - 1) ? 0 : 1) : d === 1 ? (solid(y + 1) ? 0 : 1) : 1;
        assert.equal(has(y, d), exp, `${label} states=${st.join("/")} layer ${y} dir ${d}: ${has(y, d)} faces, expected ${exp}`);
      }
    }
  };
  // brief combos: current = middle, below in {normal,dimmed,hidden}, above in {hidden,ghost}
  for (const below of ["normal", "dimmed", "hidden"] as LayerState[]) {
    for (const above of ["hidden", "ghost"] as LayerState[]) {
      const st: LayerState[] = [below, "normal", above];
      const v = new LayerView(layers, mats);
      v.setStyles((y) => st[y]);
      check(v, st, "fresh");
    }
  }
  // every start -> target transition
  const combos: LayerState[][] = [];
  for (const a of STATES) for (const b of STATES) for (const c of STATES) combos.push([a, b, c]);
  for (const from of combos) {
    for (const to of combos) {
      const v = new LayerView(layers, mats);
      v.setStyles((y) => from[y]);
      v.setStyles((y) => to[y]);
      check(v, to, `from ${from.join("/")}`);
    }
  }
  mats.dispose();
});


// ---- chest entity models (vanilla ChestModel + ModelPart.Cube unwrapping)
t("chest models: vanilla boxes, uv rects and seamless double halves", () => {
  const px = (v: number) => (v * 64) / 16; // uv (0..16) -> texture pixels
  const single = chestElements("single");
  assert.deepEqual([single[0].from, single[0].to], [[1, 0, 1], [15, 10, 15]]);
  assert.deepEqual([single[1].from, single[1].to], [[1, 9, 1], [15, 14, 15]]);
  assert.deepEqual([single[2].from, single[2].to], [[7, 7, 15], [9, 11, 16]]);
  // lid (texOffs 0,0; 14x5x14): up = region 2 with v flipped, south = region 3 turned 180 deg
  const lid = single[1].faces;
  assert.deepEqual(lid.up!.uv!.map(px), [28, 14, 42, 0]);
  assert.deepEqual(lid.down!.uv!.map(px), [14, 0, 28, 14]);
  assert.deepEqual(lid.south!.uv!.map(px), [56, 19, 42, 14]);
  assert.deepEqual(lid.north!.uv!.map(px), [28, 19, 14, 14]);
  assert.deepEqual(lid.west!.uv!.map(px), [14, 19, 0, 14]);
  assert.deepEqual(lid.east!.uv!.map(px), [42, 19, 28, 14]);
  // base (texOffs 0,19)
  assert.deepEqual(single[0].faces.south!.uv!.map(px), [56, 43, 42, 33]);
  const left = chestElements("left");
  const right = chestElements("right");
  for (let i = 0; i < 3; i++) {
    assert.equal(left[i].faces.west, undefined, "left half has no seam face");
    assert.equal(right[i].faces.east, undefined, "right half has no seam face");
    assert.ok(left[i].faces.east && right[i].faces.west);
  }
  assert.deepEqual([left[0].from[0], left[0].to[0], right[0].from[0], right[0].to[0]], [0, 15, 1, 16]);
  // each half carries half of the latch, centred on the join: left x 0..1, right x 15..16
  assert.deepEqual([left[2].from[0], left[2].to[0], right[2].from[0], right[2].to[0]], [0, 1, 15, 16]);
  // double halves are 15 wide in the texture net
  assert.deepEqual(left[1].faces.up!.uv!.map(px), [29, 14, 44, 0]);
  const e = A("minecraft:chest[facing=south,type=left,waterlogged=false]");
  assert.equal(e.quadCount, 5 + 5 + 5);
  // facing east turns the front (south) to the east, and the left half's seam to the south
  const ee = A("minecraft:chest[facing=east,type=left,waterlogged=false]");
  let maxX = 0;
  for (let i = 0; i < ee.quadCount * 4; i++) maxX = Math.max(maxX, ee.pos[i * 3]);
  assert.ok(Math.abs(maxX - 1) < 1e-6, "facing east: latch front at x = 16");
});
t("beds are vanilla block models", () => {
  for (const part of ["head", "foot"]) assert.ok(A(`minecraft:red_bed[facing=north,occupied=false,part=${part}]`).quadCount > 0);
});

// ---- materials
t("materials normalization", () => {
  const n = (s: string) => materialItems(s).map((i) => `${i.name}x${i.count}`).join("+");
  assert.equal(n("minecraft:oak_door[half=upper,facing=north]"), "");
  assert.equal(n("minecraft:oak_door[half=lower,facing=north]"), "oak_doorx1");
  assert.equal(n("minecraft:red_bed[part=head,facing=north]"), "");
  assert.equal(n("minecraft:red_bed[part=foot,facing=north]"), "red_bedx1");
  assert.equal(n("minecraft:chest[type=right,facing=north]"), "");
  assert.equal(n("minecraft:chest[type=left,facing=north]"), "chestx1");
  assert.equal(n("minecraft:oak_slab[type=double,waterlogged=false]"), "oak_slabx2");
  assert.equal(n("minecraft:water[level=0]"), "water_bucketx1");
  assert.equal(n("minecraft:water[level=3]"), "");
  assert.equal(n("minecraft:lava[level=0]"), "lava_bucketx1");
  assert.equal(n("minecraft:candle[candles=3,lit=false,waterlogged=false]"), "candlex3");
  assert.equal(n("minecraft:sea_pickle[pickles=2,waterlogged=true]"), "sea_picklex2");
  assert.equal(n("minecraft:turtle_egg[eggs=4,hatch=0]"), "turtle_eggx4");
  assert.equal(n("minecraft:air"), "");
  assert.equal(n("minecraft:oak_wall_sign[facing=north]"), "oak_signx1");
  assert.equal(n("minecraft:potted_oak_sapling"), "flower_potx1+oak_saplingx1");
});

// ---- end-to-end mesh
t("mesh a tiny schematic", async () => {
  const palette = ["minecraft:air", "minecraft:stone", "minecraft:water[level=0]", "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]"];
  const size: [number, number, number] = [3, 2, 3];
  const blocks = new Uint16Array(18);
  blocks[0] = 1; blocks[1] = 1; blocks[2] = 2; blocks[9] = 3; blocks[10] = 1;
  const s: DecodedSchematic = { id: "t", name: "t", size, palette, blocks };
  const layers = await buildLayers({ schematic: s, assets, atlas });
  assert.equal(layers.length, 2);
  const q0 = layers[0].opaque!.getAttribute("position").count / 4;
  // two touching stones (10 faces) minus the face covered by the stone above
  assert.equal(q0, 9);
  assert.ok(layers[0].translucent);
  assert.equal(layers[0].opaque!.getAttribute("color").itemSize, 4);
  assert.ok(layers[1].opaque);
  // the face hidden by the stone above is kept as a cap (and the matching one below)
  assert.equal(layers[0].capsUp!.opaque!.getAttribute("position").count / 4, 1);
  assert.equal(layers[1].capsDown!.opaque!.getAttribute("position").count / 4, 2); // stone + stair bottom
  assert.equal(layers[0].capsDown, null);
});

await Promise.all(pending);
if (process.env.PERF) {
  const palette = ["minecraft:air", "minecraft:stone", "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]", "minecraft:glass", "minecraft:oak_fence[east=true,north=true,south=false,waterlogged=false,west=false]", "minecraft:water[level=0]"];
  const size: [number, number, number] = [100, 100, 100];
  const blocks = new Uint16Array(1_000_000);
  let seed = 1;
  for (let i = 0; i < blocks.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    blocks[i] = seed % 7 < 3 ? 0 : 1 + (seed % 5);
  }
  const s2: DecodedSchematic = { id: "p", name: "p", size, palette, blocks };
  const t0 = performance.now();
  let maxGap = 0;
  let last = performance.now();
  const timer = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 1);
  const layers = await buildLayers({ schematic: s2, assets, atlas });
  clearInterval(timer);
  let quads = 0;
  for (const l of layers) for (const g of [l.opaque, l.cutout, l.translucent, l.capsUp?.opaque, l.capsDown?.opaque]) if (g) quads += g.getAttribute("position").count / 4;
  console.log(`  perf: 1M blocks -> ${quads} quads in ${(performance.now() - t0).toFixed(0)} ms, max event-loop gap ${maxGap.toFixed(0)} ms`);
}
console.log(`schematic self-check: ${passed} groups passed${process.exitCode ? " (with failures)" : ""}`);
