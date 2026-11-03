import * as THREE from "three";
import type { AssetsBundle } from "../model/types";

export type TexClass = "opaque" | "cutout" | "translucent";

export interface AtlasEntry {
  /** UV rect in atlas space (0..1, v up as three.js expects, i.e. flipY handled). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  cls: TexClass;
  /** Source frame size in pixels. */
  w: number;
  h: number;
}

/** Minimal lookup used by the baker (so it can run without a DOM in tests). */
export interface AtlasLookup {
  get(key: string): AtlasEntry;
}

export interface Atlas extends AtlasLookup {
  texture: THREE.CanvasTexture;
  width: number;
  height: number;
  has(key: string): boolean;
  /** Keys that were requested but absent from the bundle. */
  missing: string[];
}

export const MISSING_KEY = "__missing__";

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodePng(b64: string): Promise<ImageBitmap> {
  const bytes = decodeBase64(b64);
  return createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
}

interface Loaded {
  key: string;
  bmp: ImageBitmap | null;
  fw: number;
  fh: number;
  cls: TexClass;
  x: number;
  y: number;
}

const PAD = 1;
const MIN_SIZE = 128;
const MAX_SIZE = 4096;

function shelfPack(items: Loaded[], size: number): boolean {
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const it of items) {
    const w = it.fw + PAD * 2;
    const h = it.fh + PAD * 2;
    if (w > size) return false;
    if (x + w > size) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    if (y + h > size) return false;
    it.x = x + PAD;
    it.y = y + PAD;
    x += w;
    rowH = Math.max(rowH, h);
  }
  return true;
}

/**
 * Builds ONE atlas canvas from the given texture keys only. Animated textures
 * and textures taller than wide use their top square frame. A missing texture
 * gets a magenta/black checker entry (also returned for unknown keys).
 */
export async function buildAtlas(
  bundle: AssetsBundle,
  keys: Iterable<string>,
): Promise<Atlas> {
  const animated = new Set(bundle.animated);
  const want = new Set<string>(keys);
  want.delete(MISSING_KEY);
  const missing: string[] = [];

  const scratch = document.createElement("canvas");
  const sctx = scratch.getContext("2d", { willReadFrequently: true })!;

  const items: Loaded[] = [];
  const decoded = await Promise.all(
    [...want].map(async (key) => {
      const b64 = bundle.textures[key];
      if (!b64) return { key, bmp: null as ImageBitmap | null };
      try {
        return { key, bmp: await decodePng(b64) };
      } catch {
        return { key, bmp: null as ImageBitmap | null };
      }
    }),
  );
  for (const d of decoded) {
    if (!d.bmp) {
      missing.push(d.key);
      continue;
    }
    const w = d.bmp.width;
    const h = d.bmp.height;
    const square = animated.has(d.key) || h > w;
    const fw = w;
    const fh = square ? w : h;
    scratch.width = fw;
    scratch.height = fh;
    sctx.clearRect(0, 0, fw, fh);
    sctx.drawImage(d.bmp, 0, 0, fw, fh, 0, 0, fw, fh);
    const px = sctx.getImageData(0, 0, fw, fh).data;
    let cls: TexClass = "opaque";
    for (let i = 3; i < px.length; i += 4) {
      const a = px[i];
      if (a === 255) continue;
      if (a === 0) cls = "cutout";
      else {
        cls = "translucent";
        break;
      }
    }
    items.push({ key: d.key, bmp: d.bmp, fw, fh, cls, x: 0, y: 0 });
  }
  // the missing-texture checker (16x16)
  items.push({ key: MISSING_KEY, bmp: null, fw: 16, fh: 16, cls: "opaque", x: 0, y: 0 });

  items.sort((a, b) => b.fh - a.fh || b.fw - a.fw);
  let size = MIN_SIZE;
  while (!shelfPack(items, size)) {
    size *= 2;
    if (size > MAX_SIZE) throw new Error("Texture atlas does not fit in 4096x4096");
  }

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const map = new Map<string, AtlasEntry>();
  const inset = 0.01;
  for (const it of items) {
    if (it.bmp) {
      ctx.drawImage(it.bmp, 0, 0, it.fw, it.fh, it.x, it.y, it.fw, it.fh);
      it.bmp.close?.();
    } else {
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = (i + j) % 2 === 0 ? "#f800f8" : "#000000";
          ctx.fillRect(it.x + i * 8, it.y + j * 8, 8, 8);
        }
      }
    }
    // gutter: replicate edge pixels so nearest sampling never bleeds
    ctx.drawImage(canvas, it.x, it.y, it.fw, 1, it.x, it.y - 1, it.fw, 1);
    ctx.drawImage(canvas, it.x, it.y + it.fh - 1, it.fw, 1, it.x, it.y + it.fh, it.fw, 1);
    ctx.drawImage(canvas, it.x, it.y - 1, 1, it.fh + 2, it.x - 1, it.y - 1, 1, it.fh + 2);
    ctx.drawImage(canvas, it.x + it.fw - 1, it.y - 1, 1, it.fh + 2, it.x + it.fw, it.y - 1, 1, it.fh + 2);
    // canvas y grows downward; texture is flipY so v = 1 - y/size
    map.set(it.key, {
      u0: (it.x + inset) / size,
      u1: (it.x + it.fw - inset) / size,
      v1: 1 - (it.y + inset) / size,
      v0: 1 - (it.y + it.fh - inset) / size,
      cls: it.cls,
      w: it.fw,
      h: it.fh,
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const fallback = map.get(MISSING_KEY)!;
  return {
    texture,
    width: size,
    height: size,
    missing,
    has: (k) => map.has(k),
    get: (k) => map.get(k) ?? fallback,
  };
}
