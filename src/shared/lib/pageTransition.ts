import type { MouseEvent } from "react";
import { TIMING } from "@/shared/config/timings";
import {
  PAGE_TRANSITION_SPEED_MULT,
  usePageTransitionPrefs,
} from "./pageTransitionPrefs";

/**
 * Diagonal block-wipe between routes. Tiles are placed from the top-left
 * corner (cover), the route changes underneath, then they are removed in
 * the same direction (reveal). Pure canvas, solid colour, eased scaling.
 * Router wiring lives in `app/router`; the overlay element in `shared/ui`.
 */

/** Tile edge in CSS px. */
const TILE = 40;
/** Fraction of a phase one tile spends growing/shrinking. */
const TILE_SPAN = 0.58;

const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;
const easeInOutCubic = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;

type Host = {
  navigate: (to: string) => void;
  pathname: () => string;
};

type Surface = { root: HTMLElement; canvas: HTMLCanvasElement };

let host: Host | null = null;
let surface: Surface | null = null;

type Run = {
  phase: "cover" | "wait" | "reveal";
  start: number;
  target: string;
  navigated: boolean;
  preview: boolean;
  cover: number;
  reveal: number;
  raf: number;
  safety: ReturnType<typeof setTimeout>;
  color: string;
  ctx: CanvasRenderingContext2D;
  cols: number;
  rows: number;
  tile: number;
};

let run: Run | null = null;
let pending: string | null = null;

export function configurePageTransition(h: Host): void {
  host = h;
}

/** Overlay registers its elements; returns a cleanup. */
export function attachTransitionSurface(s: Surface): () => void {
  surface = s;
  return () => {
    if (surface === s) {
      finish(true);
      surface = null;
    }
  };
}

const pathOf = (to: string) => to.split(/[?#]/)[0] ?? to;

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function readColor(): string {
  const cs = getComputedStyle(document.documentElement);
  // One step off the page surface (--bg) so the wave reads on plain pages too.
  return (
    cs.getPropertyValue("--bg-panel").trim() ||
    cs.getPropertyValue("--bg").trim() ||
    cs.getPropertyValue("--bg-deep").trim() ||
    "#000"
  );
}

/** Size the backing store to the overlay; returns device tile size. */
function fit(r: Run, s: Surface): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(s.canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(s.canvas.clientHeight * dpr));
  if (s.canvas.width !== w) s.canvas.width = w;
  if (s.canvas.height !== h) s.canvas.height = h;
  r.tile = Math.max(1, Math.round(TILE * dpr));
  r.cols = Math.ceil(w / r.tile);
  r.rows = Math.ceil(h / r.tile);
}

function draw(r: Run, s: Surface, reveal: boolean, t: number, dur: number): void {
  fit(r, s);
  const { ctx, cols, rows, tile } = r;
  const w = s.canvas.width;
  const h = s.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = r.color;
  const dmax = Math.max(1, cols + rows - 2);
  const span = dur * TILE_SPAN;
  ctx.beginPath();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const delay = ((i + j) / dmax) * (dur - span);
      const p = Math.min(1, Math.max(0, (t - delay) / span));
      const sc = reveal ? 1 - easeInOutCubic(p) : easeOutCubic(p);
      if (sc <= 0) continue;
      if (sc >= 1) {
        // Fully grown tiles snap to device pixels so there are no seams.
        ctx.rect(i * tile, j * tile, tile + 1, tile + 1);
      } else {
        const side = tile * sc;
        if (side < 0.5) continue;
        const off = (tile - side) / 2;
        ctx.rect(i * tile + off, j * tile + off, side, side);
      }
    }
  }
  ctx.fill();
}

function setActive(s: Surface | null, on: boolean): void {
  s?.root.classList.toggle("is-active", on);
}

function doNavigate(r: Run): void {
  if (r.navigated) return;
  r.navigated = true;
  if (r.preview) return;
  const to = pending ?? r.target;
  pending = null;
  host?.navigate(to);
}

function finish(force: boolean): void {
  const r = run;
  if (!r) return;
  cancelAnimationFrame(r.raf);
  clearTimeout(r.safety);
  run = null;
  if (force) {
    if (r.navigated && !r.preview && pending) host?.navigate(pending);
    else doNavigate(r);
  }
  if (surface) {
    surface.canvas
      .getContext("2d")
      ?.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    setActive(surface, false);
  }
  const next = pending;
  pending = null;
  if (next && !force) transitionTo(next);
}

function tick(now: number): void {
  const r = run;
  const s = surface;
  if (!r || !s) return;
  if (r.phase === "cover") {
    const t = now - r.start;
    if (t < r.cover) {
      draw(r, s, false, t, r.cover);
      r.raf = requestAnimationFrame(tick);
      return;
    }
    draw(r, s, false, r.cover, r.cover);
    r.phase = "wait";
    doNavigate(r);
    // Two frames so the new page has rendered under the cover.
    r.raf = requestAnimationFrame(() => {
      r.raf = requestAnimationFrame((n) => {
        r.phase = "reveal";
        r.start = n;
        tick(n);
      });
    });
    return;
  }
  if (r.phase === "reveal") {
    const t = now - r.start;
    if (t < r.reveal) {
      draw(r, s, true, t, r.reveal);
      r.raf = requestAnimationFrame(tick);
      return;
    }
    finish(false);
  }
}

/** Navigate with the tile wipe. Same path, disabled or reduced motion: immediate. */
export function transitionTo(to: string): void {
  if (!host) return;
  if (run) {
    pending = to;
    return;
  }
  if (
    pathOf(to) === pathOf(host.pathname()) ||
    reducedMotion() ||
    !usePageTransitionPrefs.getState().enabled
  ) {
    host.navigate(to);
    return;
  }
  if (!start(to, false)) host.navigate(to);
}

/** Play cover + reveal on the current page without navigating. */
export function playPageTransitionPreview(): void {
  if (run || !host || reducedMotion()) return;
  start(host.pathname(), true);
}

function start(to: string, preview: boolean): boolean {
  const s = surface;
  const ctx = s?.canvas.getContext("2d") ?? null;
  if (!s || !ctx) return false;
  const m = PAGE_TRANSITION_SPEED_MULT[usePageTransitionPrefs.getState().speed];
  const cover = TIMING.pageCover * m;
  const reveal = TIMING.pageReveal * m;
  const r: Run = {
    phase: "cover",
    start: performance.now(),
    target: to,
    navigated: false,
    preview,
    cover,
    reveal,
    raf: 0,
    safety: setTimeout(
      () => finish(true),
      Math.max(TIMING.pageSafety * m, (cover + reveal) * 2),
    ),
    color: readColor(),
    ctx,
    cols: 0,
    rows: 0,
    tile: 1,
  };
  run = r;
  pending = null;
  setActive(s, true);
  r.raf = requestAnimationFrame((n) => {
    r.start = n;
    tick(n);
  });
  return true;
}

/** onClick for router links: plain left clicks animate, the rest stay native. */
export function transitionClick(to: string) {
  return (e: MouseEvent<HTMLElement>) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    transitionTo(to);
  };
}
