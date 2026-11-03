import * as THREE from "three";
import {
  buildLayers,
  materialItems,
  parseBlockState,
  type Atlas,
  type DecodedSchematic,
  type SchematicMaterials,
} from "@/entities/schematic";
import { useIconStore } from "./iconStore";
import type { SchematicModel } from "./useSchematicLoader";

const caches = new WeakMap<Atlas, Map<string, string | null>>();

/** 32px pixelated data URL of a texture cropped from the atlas canvas, or null. */
export function atlasIconUrl(atlas: Atlas, key: string | null): string | null {
  if (!key || !atlas.has(key)) return null;
  let cache = caches.get(atlas);
  if (!cache) caches.set(atlas, (cache = new Map()));
  if (cache.has(key)) return cache.get(key)!;
  let url: string | null = null;
  try {
    const src = atlas.texture.image as HTMLCanvasElement;
    const e = atlas.get(key);
    const sx = Math.round(e.u0 * atlas.width);
    const sy = Math.round((1 - e.v1) * atlas.height);
    // animated textures: only the first (square) frame
    const w = Math.max(1, e.w);
    const h = Math.max(1, Math.min(e.h, e.w));
    const out = document.createElement("canvas");
    out.width = out.height = 32;
    const ctx = out.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, sx, sy, w, h, 0, 0, 32, 32);
      url = out.toDataURL("image/png");
    }
  } catch {
    url = null;
  }
  cache.set(key, url);
  return url;
}

// ---------- 3D inventory-style icons ----------

export const ICON_SIZE = 64;

/**
 * Icons are drawn with the main scene's renderer into an offscreen render target: the block
 * materials and the atlas texture already live in that WebGL context. A second context would
 * have to re-upload the (up to 4096²) atlas, which WebKit (macOS webview) does unreliably and
 * which gave empty icons there. Without a host renderer nothing is rendered: the pipeline waits.
 */
let hostRenderer: THREE.WebGLRenderer | null = null;
let iconRig: { camera: THREE.OrthographicCamera; scene: THREE.Scene; rt: THREE.WebGLRenderTarget } | null = null;
const rendererWaiters = new Set<() => void>();

/** Called by the scene with its renderer (and null when it is disposed). */
export function setIconRenderer(r: THREE.WebGLRenderer | null) {
  if (hostRenderer !== r && iconRig) {
    iconRig.rt.dispose();
    iconRig = null;
  }
  hostRenderer = r;
  if (r) {
    const w = [...rendererWaiters];
    rendererWaiters.clear();
    for (const f of w) f();
  }
}

function rig() {
  if (iconRig) return iconRig;
  // Classic inventory angle: 30 degrees pitch, 45 degrees yaw (south face left, east face right).
  const half = 0.82;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 20);
  const pitch = (30 * Math.PI) / 180;
  const yaw = (45 * Math.PI) / 180;
  const c = new THREE.Vector3(0.5, 0.5, 0.5);
  camera.position.set(
    c.x + 8 * Math.sin(yaw) * Math.cos(pitch),
    c.y + 8 * Math.sin(pitch),
    c.z + 8 * Math.cos(yaw) * Math.cos(pitch),
  );
  camera.lookAt(c);
  camera.updateMatrixWorld();
  const rt = new THREE.WebGLRenderTarget(ICON_SIZE, ICON_SIZE, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  iconRig = { camera, scene: new THREE.Scene(), rt };
  return iconRig;
}

/** Frees icon GPU resources (call when the Schematics page unmounts). */
export function disposeIconRenderer() {
  iconRig?.rt.dispose();
  iconRig = null;
}

const readBuf = new Uint8Array(ICON_SIZE * ICON_SIZE * 4);

/** Render the rig scene offscreen and return it as a PNG data URL (rows flipped to top-down). */
function snapshot(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, rt: THREE.WebGLRenderTarget) {
  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  const prevScissorTest = renderer.getScissorTest();
  try {
    renderer.setRenderTarget(rt);
    renderer.autoClear = true;
    // A leftover scissor test would crop the snapshot. No setViewport here: in three.js it sets the
    // canvas viewport even while a render target is bound (the target uses its own rt.viewport),
    // which shrank the main scene to a 64px corner.
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, ICON_SIZE, ICON_SIZE, readBuf);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAutoClear;
    renderer.setScissorTest(prevScissorTest);
  }
  const out = document.createElement("canvas");
  out.width = out.height = ICON_SIZE;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(ICON_SIZE, ICON_SIZE);
  const row = ICON_SIZE * 4;
  let any = false;
  for (let y = 0; y < ICON_SIZE; y++) {
    const src = (ICON_SIZE - 1 - y) * row;
    img.data.set(readBuf.subarray(src, src + row), y * row);
  }
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] !== 0) {
      any = true;
      break;
    }
  }
  if (!any) return null; // nothing drawn: let the caller fall back to a flat texture
  ctx.putImageData(img, 0, 0);
  return out.toDataURL("image/png");
}

/** Icon states: face the front toward the camera, split double chests into one. */
function iconState(state: string): string {
  const { name, props } = parseBlockState(state);
  const p = { ...props };
  if (p.facing && ["north", "east", "west"].includes(p.facing)) p.facing = "south";
  if (p.type === "left" || p.type === "right") p.type = "single";
  const parts = Object.entries(p).map(([k, v]) => `${k}=${v}`);
  return `minecraft:${name}${parts.length ? `[${parts.join(",")}]` : ""}`;
}

/** Cross-shaped (diagonal plane) models read better as their flat texture. */
function isCross(geo: THREE.BufferGeometry[]): boolean {
  let any = false;
  for (const g of geo) {
    const n = g.getAttribute("normal");
    for (let i = 0; i < n.count; i += 4) {
      any = true;
      if (Math.abs(n.getY(i)) > 0.1 || Math.abs(n.getX(i)) < 0.3 || Math.abs(n.getZ(i)) < 0.3) return false;
    }
  }
  return any;
}

type BlockIcon = { kind: "ok"; url: string } | { kind: "flat" } | { kind: "empty" };

/** "flat": the model is not worth a 3D icon; "empty": the snapshot came out blank (transient). */
async function renderBlockIcon(model: SchematicModel, state: string): Promise<BlockIcon> {
  const schematic: DecodedSchematic = {
    id: "icon",
    name: "icon",
    size: [1, 1, 1],
    palette: ["minecraft:air", iconState(state)],
    blocks: new Uint16Array([1]),
  };
  const layers = await buildLayers({
    schematic,
    assets: model.assets,
    atlas: model.atlas,
    yieldMs: Infinity,
  });
  const l = layers[0];
  const geos = [l?.opaque, l?.cutout, l?.translucent].filter((g): g is THREE.BufferGeometry => !!g);
  try {
    if (geos.length === 0) return { kind: "empty" };
    if (isCross(geos)) return { kind: "flat" };
    const renderer = hostRenderer;
    if (!renderer) return { kind: "empty" };
    const { camera, scene, rt } = rig();
    const mats: SchematicMaterials = model.materials;
    const meshes: THREE.Mesh[] = [];
    const add = (g: THREE.BufferGeometry | null | undefined, kind: "opaque" | "cutout" | "translucent") => {
      if (!g) return;
      const m = new THREE.Mesh(g, mats.normal[kind]);
      m.renderOrder = kind === "translucent" ? 2 : 0;
      meshes.push(m);
      scene.add(m);
    };
    add(l.opaque, "opaque");
    add(l.cutout, "cutout");
    add(l.translucent, "translucent");
    let url: string | null;
    try {
      url = snapshot(renderer, scene, camera, rt);
    } finally {
      scene.remove(...meshes);
    }
    return url ? { kind: "ok", url } : { kind: "empty" };
  } finally {
    for (const g of geos) g.dispose();
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("icon texture failed to decode"));
    img.src = src;
  });
}

/** Item texture (first frame of strips) upscaled without smoothing. */
async function flatItemIcon(base64: string): Promise<string | null> {
  try {
    const img = await loadImage(`data:image/png;base64,${base64}`);
    const w = img.naturalWidth;
    const h = Math.min(img.naturalHeight, w);
    const out = document.createElement("canvas");
    out.width = out.height = ICON_SIZE;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h, 0, 0, ICON_SIZE, ICON_SIZE);
    return out.toDataURL("image/png");
  } catch {
    return null;
  }
}

// ---------- one icon pipeline per loaded model ----------

const cache = new Map<string, string>();

/** Item an icon is drawn for: the placed block's item (wall_torch -> torch, door halves -> door). */
export function iconKeyFor(state: string): string {
  const { name } = parseBlockState(state);
  const norm = state
    .replace("half=upper", "half=lower")
    .replace("part=head", "part=foot")
    .replace("type=right", "type=single");
  return materialItems(norm)[0]?.name ?? materialItems(state)[0]?.name ?? name;
}

interface Job {
  key: string;
  state: string | null;
  texture: string | null;
  tries: number;
}

interface Pipeline {
  bump(key: string): void;
  stop(): void;
}

let active: Pipeline | null = null;

/** Raise a key to the front of the active queue (tooltip hover). */
export function prioritizeIcon(key: string) {
  active?.bump(key);
}

let channel: MessageChannel | null = null;
/** One macrotask hop that, unlike setTimeout, is not throttled in background windows. */
function yieldTick(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((r) => requestAnimationFrame(() => r()));
  if (!channel) channel = new MessageChannel();
  const ch = channel;
  return new Promise<void>((resolve) => {
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

function flatTexture(model: SchematicModel, job: Job): string | null {
  const tries = [job.texture, `block/${job.key}`, `block/${job.key}_top`, `block/${job.key}_side`];
  for (const t of tries) {
    const u = atlasIconUrl(model.atlas, t);
    if (u) return u;
  }
  return null;
}

/**
 * Starts rendering every icon the loaded model can need (materials first, then every palette
 * block for the tooltip), sequentially, one per tick, into the reactive icon store.
 */
export function startIconPipeline(model: SchematicModel): () => void {
  active?.stop();
  const version = model.assets.bundle.version;
  const ck = (key: string) => `${version}:${key}`;
  let alive = true;

  const jobs = new Map<string, Job>();
  const order: Job[] = [];
  const add = (key: string, state: string | null, texture: string | null) => {
    const ex = jobs.get(key);
    if (ex) {
      if (!ex.state && state) ex.state = state;
      return;
    }
    const j: Job = { key, state, texture, tries: 0 };
    jobs.set(key, j);
    order.push(j);
  };
  for (const l of model.list.total) add(l.name, l.state, l.iconTexture);
  for (const state of model.decoded.palette) {
    if (/^(minecraft:)?(cave_|void_)?air(\[|$)/.test(state)) continue;
    add(iconKeyFor(state), state, null);
  }

  // Seed from the module cache: re-opening a schematic is instant.
  const seed: Record<string, string> = {};
  const queue: Job[] = [];
  for (const j of order) {
    const hit = cache.get(ck(j.key));
    if (hit) seed[j.key] = hit;
    else queue.push(j);
  }
  useIconStore.setState({ icons: seed });

  const put = (key: string, url: string) => {
    useIconStore.setState((s) => ({ icons: { ...s.icons, [key]: url } }));
  };

  async function make(job: Job): Promise<{ url: string; final: boolean } | "wait" | "retry" | null> {
    const item = model.assets.bundle.textures[`item/${job.key}`];
    if (item) {
      const u = await flatItemIcon(item);
      if (u) return { url: u, final: true };
    }
    if (job.state) {
      if (!hostRenderer) return "wait";
      let res: BlockIcon | null = null;
      try {
        res = await renderBlockIcon(model, job.state);
      } catch {
        res = { kind: "empty" };
      }
      if (!alive) return null;
      if (res.kind === "ok") return { url: res.url, final: true };
      if (res.kind === "empty") {
        if (!hostRenderer) return "wait";
        if (job.tries < 1) return "retry";
      }
    }
    const flat = flatTexture(model, job);
    // A flat texture is the answer for cross models; after failed retries it is only a fallback.
    return flat ? { url: flat, final: job.state ? false : true } : null;
  }

  let running = false;
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (alive && queue.length) {
        await yieldTick();
        if (!alive) break;
        const job = queue.shift()!;
        if (useIconStore.getState().icons[job.key]) continue;
        const r = await make(job);
        if (!alive) break;
        if (r === "wait") {
          queue.unshift(job);
          await new Promise<void>((resolve) => {
            rendererWaiters.add(resolve);
          });
          continue;
        }
        if (r === "retry") {
          job.tries++;
          queue.push(job);
          continue;
        }
        if (r) {
          put(job.key, r.url);
          if (r.final) cache.set(ck(job.key), r.url);
        }
      }
    } finally {
      running = false;
    }
  }

  const self: Pipeline = {
    bump(key) {
      const i = queue.findIndex((j) => j.key === key);
      if (i > 0) queue.unshift(...queue.splice(i, 1));
    },
    stop() {
      alive = false;
      queue.length = 0;
      const w = [...rendererWaiters];
      rendererWaiters.clear();
      for (const f of w) f(); // release a parked pump so it can exit
      if (active === self) active = null;
    },
  };
  active = self;
  void pump();
  return () => self.stop();
}
