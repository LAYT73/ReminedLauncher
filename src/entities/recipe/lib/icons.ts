import type { IconRef, ModelElement, ModelFace, ModelFaceDir, ModelGui, RecipeIndex, RecipeItem } from "../model/types";

const SIZE = 64;

type Listener = (url: string) => void;

function rgb(c: number | undefined): [number, number, number] | null {
  return c == null ? null : [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

function makeCanvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Top square frame of a (possibly animated) texture, shaded + tinted into an n*n canvas. */
function faceCanvas(img: HTMLImageElement, shade: number, tint: number | undefined): HTMLCanvasElement {
  const n = Math.max(1, Math.min(img.naturalWidth, img.naturalHeight || img.naturalWidth));
  const [c, ctx] = makeCanvas(n);
  ctx.drawImage(img, 0, 0, n, n, 0, 0, n, n);
  const t = rgb(tint);
  if (shade !== 1 || t) {
    const d = ctx.getImageData(0, 0, n, n);
    const px = d.data;
    const mr = (t ? t[0] / 255 : 1) * shade;
    const mg = (t ? t[1] / 255 : 1) * shade;
    const mb = (t ? t[2] / 255 : 1) * shade;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = px[i] * mr;
      px[i + 1] = px[i + 1] * mg;
      px[i + 2] = px[i + 2] * mb;
    }
    ctx.putImageData(d, 0, 0);
  }
  return c;
}

function flatIcon(layers: { img: HTMLImageElement; tint: number | undefined }[]): string {
  const [c, ctx] = makeCanvas(SIZE);
  for (const l of layers) {
    const face = faceCanvas(l.img, 1, l.tint);
    ctx.drawImage(face, 0, 0, face.width, face.height, 0, 0, SIZE, SIZE);
  }
  return c.toDataURL("image/png");
}

function cubeIcon(top: HTMLImageElement, side: HTMLImageElement, front: HTMLImageElement, tint: IconRef & { k: "cube" }): string {
  const [c, ctx] = makeCanvas(SIZE);
  // Isometric cube (2:1): T(32,3) R(60,17) C(32,31) L(4,17); sides 28px tall. Top: origin L, x toward T, y toward C.
  const faces: { img: HTMLCanvasElement; o: [number, number]; u: [number, number]; v: [number, number] }[] = [
    { img: faceCanvas(side, 0.8, tint.tint?.side), o: [4, 17], u: [28, 14], v: [0, 28] },
    { img: faceCanvas(front, 0.64, tint.tint?.front), o: [32, 31], u: [28, -14], v: [0, 28] },
    { img: faceCanvas(top, 1, tint.tint?.top), o: [4, 17], u: [28, -14], v: [28, 14] },
  ];
  for (const f of faces) {
    const n = f.img.width;
    ctx.save();
    ctx.setTransform(f.u[0] / n, f.u[1] / n, f.v[0] / n, f.v[1] / n, f.o[0], f.o[1]);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f.img, 0, 0);
    ctx.restore();
  }
  return c.toDataURL("image/png");
}

type V3 = [number, number, number];

const rotAxis = (v: V3, axis: 0 | 1 | 2, deg: number): V3 => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const [x, y, z] = v;
  if (axis === 0) return [x, y * c - z * s, y * s + z * c];
  if (axis === 1) return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
};

/** Face corner (O) and edge vectors (U along texture u, V along texture v) in block space, MC conventions. */
function faceFrame(dir: ModelFaceDir, f: V3, t: V3): { o: V3; u: V3; v: V3 } {
  const [x1, y1, z1] = f;
  const [x2, y2, z2] = t;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  switch (dir) {
    case "south": return { o: [x1, y2, z2], u: [dx, 0, 0], v: [0, -dy, 0] };
    case "north": return { o: [x2, y2, z1], u: [-dx, 0, 0], v: [0, -dy, 0] };
    case "east": return { o: [x2, y2, z2], u: [0, 0, -dz], v: [0, -dy, 0] };
    case "west": return { o: [x1, y2, z1], u: [0, 0, dz], v: [0, -dy, 0] };
    case "up": return { o: [x1, y2, z1], u: [dx, 0, 0], v: [0, 0, dz] };
    default: return { o: [x1, y1, z2], u: [dx, 0, 0], v: [0, 0, -dz] }; // down
  }
}

/** View-space light (tuned so a default block reads 100% top / ~80% left / ~64% right like the inventory). */
const LIGHT: V3 = [-0.113, 0.277, 0.52];

type DrawFace = {
  img: HTMLCanvasElement;
  m: [number, number, number, number, number, number];
  /** depth at texel (0,0) and its change per texel column / row (larger = nearer). */
  z0: number;
  zx: number;
  zy: number;
};

/**
 * Real geometry in 2D: gui display transform (scale, rotate Z/Y/X, translate; orthographic), element rotation,
 * back-face culling and an affine texture map per face (exact for parallel projection), rasterised with a
 * z-buffer; ties go to the later element like the game (shulker lid over its base).
 */
function modelIcon(
  gui: ModelGui,
  elements: ModelElement[],
  tex: (key: string) => { img: HTMLImageElement; entity: boolean } | null,
): string | null {
  const faces: DrawFace[] = [];
  const toView = (p: V3): V3 => {
    let q: V3 = [(p[0] - 8) / 16, (p[1] - 8) / 16, (p[2] - 8) / 16];
    q = [q[0] * gui.scale[0], q[1] * gui.scale[1], q[2] * gui.scale[2]];
    q = rotAxis(rotAxis(rotAxis(q, 2, gui.rotation[2]), 1, -gui.rotation[1]), 0, gui.rotation[0]);
    return [q[0] + gui.translation[0] / 16, q[1] + gui.translation[1] / 16, q[2] + gui.translation[2] / 16];
  };
  for (const el of elements) {
    const ax = el.rotation ? ({ x: 0, y: 1, z: 2 } as const)[el.rotation.axis] : 0;
    const elRot = (p: V3): V3 => {
      const r = el.rotation;
      if (!r || !r.angle) return p;
      const o = r.origin;
      let q: V3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
      q = rotAxis(q, ax, r.angle);
      if (r.rescale) {
        const k = 1 / Math.cos((r.angle * Math.PI) / 180);
        for (let i = 0; i < 3; i++) if (i !== ax) q[i] *= k;
      }
      return [q[0] + o[0], q[1] + o[1], q[2] + o[2]];
    };
    for (const [dir, face] of Object.entries(el.faces) as [ModelFaceDir, ModelFace][]) {
      const tx = tex(face.t);
      if (!tx) continue;
      const fr = faceFrame(dir, el.from, el.to);
      const O = toView(elRot(fr.o));
      const U = toView(elRot([fr.o[0] + fr.u[0], fr.o[1] + fr.u[1], fr.o[2] + fr.u[2]]));
      const V = toView(elRot([fr.o[0] + fr.v[0], fr.o[1] + fr.v[1], fr.o[2] + fr.v[2]]));
      const u: V3 = [U[0] - O[0], U[1] - O[1], U[2] - O[2]];
      const v: V3 = [V[0] - O[0], V[1] - O[1], V[2] - O[2]];
      // outward normal = V x U (U x V points inward for every MC face frame)
      const n: V3 = [v[1] * u[2] - v[2] * u[1], v[2] * u[0] - v[0] * u[2], v[0] * u[1] - v[1] * u[0]];
      const len = Math.hypot(n[0], n[1], n[2]);
      if (len < 1e-9 || n[2] <= 0) continue; // degenerate or back-facing
      const light = Math.max(0.45, Math.min(1, 0.5 + (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / len));

      // texture crop
      const iw = tx.img.naturalWidth;
      const ih = tx.img.naturalHeight;
      const fw = iw;
      const fh = tx.entity ? ih : Math.min(iw, ih);
      const [u1, v1, u2, v2] = face.uv;
      const sx = Math.max(0, Math.floor((Math.min(u1, u2) * fw) / 16));
      const sy = Math.max(0, Math.floor((Math.min(v1, v2) * fh) / 16));
      const sw = Math.max(1, Math.min(fw - sx, Math.round((Math.abs(u2 - u1) * fw) / 16)));
      const sh = Math.max(1, Math.min(fh - sy, Math.round((Math.abs(v2 - v1) * fh) / 16)));
      const crop = shadedCrop(tx.img, sx, sy, sw, sh, light, face.tint);

      const flipU = u1 > u2;
      const flipV = v1 > v2;
      const rot = ((face.rotation ?? 0) / 90) | 0;
      // crop-normalized (a,b) -> face (s,t) -> view position
      const at = (a: number, b: number): [number, number, number] => {
        const fa = flipU ? 1 - a : a;
        const fb = flipV ? 1 - b : b;
        let s = fa;
        let t = fb;
        if (rot === 1) [s, t] = [1 - fb, fa];
        else if (rot === 2) [s, t] = [1 - fa, 1 - fb];
        else if (rot === 3) [s, t] = [fb, 1 - fa];
        return [O[0] + u[0] * s + v[0] * t, O[1] + u[1] * s + v[1] * t, O[2] + u[2] * s + v[2] * t];
      };
      const p00 = at(0, 0);
      const p10 = at(1, 0);
      const p01 = at(0, 1);
      // view (x right, y up) -> canvas; crop pixel (px,py) -> a=px/sw, b=py/sh
      const X = (p: [number, number, number]) => SIZE / 2 + p[0] * SIZE;
      const Y = (p: [number, number, number]) => SIZE / 2 - p[1] * SIZE;
      const m: DrawFace["m"] = [
        (X(p10) - X(p00)) / sw,
        (Y(p10) - Y(p00)) / sw,
        (X(p01) - X(p00)) / sh,
        (Y(p01) - Y(p00)) / sh,
        X(p00),
        Y(p00),
      ];
      faces.push({ img: crop, m, z0: p00[2], zx: (p10[2] - p00[2]) / sw, zy: (p01[2] - p00[2]) / sh });
    }
  }
  if (faces.length === 0) return null;

  // Fit like the game; only shrink/shift when the model would leave the icon (beds, chests).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of faces) {
    const w = f.img.width;
    const h = f.img.height;
    for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const x = f.m[0] * px + f.m[2] * py + f.m[4];
      const y = f.m[1] * px + f.m[3] * py + f.m[5];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const pad = 2;
  const k = Math.min(1, (SIZE - 2 * pad) / Math.max(1, maxX - minX), (SIZE - 2 * pad) / Math.max(1, maxY - minY));
  let dx = 0;
  let dy = 0;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  if (k < 1) {
    dx = SIZE / 2 - cx * k;
    dy = SIZE / 2 - cy * k;
  } else {
    if (minX < pad) dx = pad - minX;
    else if (maxX > SIZE - pad) dx = SIZE - pad - maxX;
    if (minY < pad) dy = pad - minY;
    else if (maxY > SIZE - pad) dy = SIZE - pad - maxY;
  }

  const [c, ctx] = makeCanvas(SIZE);
  const out = ctx.createImageData(SIZE, SIZE);
  const od = out.data;
  const zbuf = new Float32Array(SIZE * SIZE).fill(-Infinity);
  for (const f of faces) {
    const sw = f.img.width;
    const sh = f.img.height;
    const px = f.img.getContext("2d")!.getImageData(0, 0, sw, sh).data;
    const a = f.m[0] * k;
    const b = f.m[1] * k;
    const cc = f.m[2] * k;
    const d = f.m[3] * k;
    const e = f.m[4] * k + dx;
    const g = f.m[5] * k + dy;
    const det = a * d - b * cc;
    if (Math.abs(det) < 1e-9) continue;
    for (let Y = 0; Y < SIZE; Y++) {
      for (let X = 0; X < SIZE; X++) {
        const rx = X + 0.5 - e;
        const ry = Y + 0.5 - g;
        const tx = (d * rx - cc * ry) / det;
        const ty = (-b * rx + a * ry) / det;
        if (tx < 0 || ty < 0 || tx >= sw || ty >= sh) continue;
        const ix = Math.floor(tx);
        const iy = Math.floor(ty);
        const si = (iy * sw + ix) * 4;
        const al = px[si + 3];
        if (al < 8) continue;
        const z = f.z0 + f.zx * tx + f.zy * ty;
        const o = Y * SIZE + X;
        if (z < zbuf[o] - 1e-5) continue;
        const oi = o * 4;
        if (al >= 250) {
          od[oi] = px[si]; od[oi + 1] = px[si + 1]; od[oi + 2] = px[si + 2]; od[oi + 3] = 255;
          zbuf[o] = z;
        } else {
          const t = al / 255;
          const da = od[oi + 3] / 255;
          const oa = t + da * (1 - t);
          for (let q = 0; q < 3; q++) od[oi + q] = (px[si + q] * t + od[oi + q] * da * (1 - t)) / oa;
          od[oi + 3] = oa * 255;
        }
      }
    }
  }
  ctx.putImageData(out, 0, 0);
  return c.toDataURL("image/png");
}

function shadedCrop(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, shade: number, tint: number | undefined): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(sw, sh);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const t = rgb(tint);
  const d = ctx.getImageData(0, 0, sw, sh);
  const px = d.data;
  const mr = (t ? t[0] / 255 : 1) * shade;
  const mg = (t ? t[1] / 255 : 1) * shade;
  const mb = (t ? t[2] / 255 : 1) * shade;
  for (let i = 0; i < px.length; i += 4) {
    px[i] *= mr;
    px[i + 1] *= mg;
    px[i + 2] *= mb;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

function initialsIcon(name: string, id: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  const text = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? id).slice(0, 2)).toUpperCase();
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const [c, ctx] = makeCanvas(SIZE);
  ctx.fillStyle = `hsl(${Math.abs(h) % 360} 18% 16%)`;
  ctx.fillRect(4, 4, SIZE - 8, SIZE - 8);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 3;
  ctx.strokeRect(5.5, 5.5, SIZE - 11, SIZE - 11);
  ctx.fillStyle = "#d8d8d8";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, SIZE / 2, SIZE / 2 + 2);
  return c.toDataURL("image/png");
}

/** Schedules `fn` soon without blocking input (MessageChannel; rIC is flaky in webviews). */
function scheduler() {
  const ch = typeof MessageChannel !== "undefined" ? new MessageChannel() : null;
  let cb: (() => void) | null = null;
  if (ch) ch.port1.onmessage = () => {
    const f = cb;
    cb = null;
    f?.();
  };
  return (fn: () => void) => {
    if (ch) {
      cb = fn;
      ch.port2.postMessage(0);
    } else setTimeout(fn, 0);
  };
}

function popLast(set: Set<string>): string | undefined {
  let last: string | undefined;
  for (const v of set) last = v;
  if (last !== undefined) set.delete(last);
  return last;
}

/** Lazy, cached icon renderer for one recipe index. */
export class IconRenderer {
  private urls = new Map<string, string>();
  private waiting = new Map<string, Set<Listener>>();
  private order = new Set<string>();
  /** Icons needed right now by the viewer: always served before the grid. */
  private hot = new Set<string>();
  private textures = new Map<string, Promise<HTMLImageElement | null>>();
  private running = false;
  private disposed = false;
  private schedule = scheduler();

  constructor(private index: RecipeIndex, private items: Map<string, RecipeItem>) {}

  peek(id: string): string | undefined {
    return this.urls.get(id);
  }

  /** Returns the cached url, or queues a render and calls `cb` when ready. Returns an unsubscribe. */
  request(id: string, cb: Listener, high = false): () => void {
    const hit = this.urls.get(id);
    if (hit) {
      cb(hit);
      return () => {};
    }
    let set = this.waiting.get(id);
    if (!set) {
      set = new Set();
      this.waiting.set(id, set);
    }
    set.add(cb);
    const q = high ? this.hot : this.order;
    q.delete(id); // re-add at the end => most recent
    q.add(id);
    this.kick();
    return () => {
      const s = this.waiting.get(id);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) {
        this.waiting.delete(id);
        this.order.delete(id);
        this.hot.delete(id);
      }
    };
  }

  dispose() {
    this.disposed = true;
    this.waiting.clear();
    this.order.clear();
    this.hot.clear();
  }

  private kick() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.schedule(() => void this.pump());
  }

  private next(): string | undefined {
    // Most recently requested (= currently visible) first.
    for (;;) {
      const id = popLast(this.hot) ?? popLast(this.order);
      if (id === undefined) return undefined;
      if (this.waiting.has(id) && !this.urls.has(id)) return id;
    }
  }

  private async pump() {
    const start = performance.now();
    while (performance.now() - start < 12 && !this.disposed) {
      const batch: string[] = [];
      for (let i = 0; i < 8; i++) {
        const id = this.next();
        if (id === undefined) break;
        if (!batch.includes(id)) batch.push(id);
      }
      if (batch.length === 0) break;
      const urls = await Promise.all(batch.map((id) => this.render(id)));
      batch.forEach((id, i) => {
        this.urls.set(id, urls[i]);
        const set = this.waiting.get(id);
        this.waiting.delete(id);
        set?.forEach((f) => f(urls[i]));
      });
    }
    this.running = false;
    if ((this.order.size || this.hot.size) && !this.disposed) this.kick();
  }

  private texture(key: string): Promise<HTMLImageElement | null> {
    let p = this.textures.get(key);
    if (!p) {
      const b64 = this.index.textures[key];
      p = b64
        ? new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = `data:image/png;base64,${b64}`;
          })
        : Promise.resolve(null);
      this.textures.set(key, p);
    }
    return p;
  }

  private async render(id: string): Promise<string> {
    const item = this.items.get(id);
    const name = item?.name ?? id;
    const ref = item?.icon;
    try {
      if (ref) {
        if (ref.k === "model") {
          const keys = new Set<string>();
          for (const el of ref.elements) for (const f of Object.values(el.faces)) if (f) keys.add(f.t);
          const loaded = new Map<string, HTMLImageElement>();
          await Promise.all([...keys].map(async (k) => {
            const img = await this.texture(k);
            if (img) loaded.set(k, img);
          }));
          const url = modelIcon(ref.gui, ref.elements, (k) => {
            const img = loaded.get(k);
            return img ? { img, entity: k.includes("entity/") } : null;
          });
          if (url) return url;
        } else if (ref.k === "cube") {
          const [top, side, front] = await Promise.all([this.texture(ref.top), this.texture(ref.side), this.texture(ref.front)]);
          if (top && side && front) return cubeIcon(top, side, front, ref);
        } else {
          const defs: { t: string; tint?: number }[] =
            ref.k === "flat" && ref.layers?.length ? ref.layers : [{ t: ref.t, tint: ref.tint }];
          const imgs = await Promise.all(defs.map((d) => this.texture(d.t)));
          const layers = defs.flatMap((d, i) => (imgs[i] ? [{ img: imgs[i]!, tint: d.tint }] : []));
          if (layers.length) return flatIcon(layers);
        }
      }
    } catch {
      /* fall through to the placeholder */
    }
    return initialsIcon(name, id);
  }
}
