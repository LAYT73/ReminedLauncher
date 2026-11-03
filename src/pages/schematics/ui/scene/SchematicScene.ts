import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { pickBlock, type PickResult } from "@/entities/schematic";
import { t } from "@/shared/i18n";
import {
  TAPE_MAX,
  tapeLabel,
  tapeMetrics,
  type TapeMeasure,
  type TapePoint,
  type TapeState,
} from "../../model/measure";
import type { SchematicModel } from "../../model/useSchematicLoader";
import { setIconRenderer } from "../../model/iconCache";
import { ViewCube, type CubeLabels } from "./ViewCube";

export interface SceneView {
  mode: "layers" | "whole";
  layer: number;
  below: "dim" | "normal" | "hide";
  showAbove: boolean;
  grid: boolean;
}

export interface HoverInfo {
  pick: PickResult;
  /** Pointer position relative to the host element. */
  x: number;
  y: number;
}

export interface SceneEvents {
  onHover: (info: HoverInfo | null) => void;
  /** Measuring tape: pinned list / pending point changed. */
  onTape: (state: TapeState) => void;
  /** Camera looks straight down (`top`) / up (`bottom`) or is on a side (`null`). Fired on change only. */
  onPole?: (pole: "top" | "bottom" | null) => void;
  cubeLabels: CubeLabels;
}

function cssColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new THREE.Color(v || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

interface Tween {
  t0: number;
  dur: number;
  /** Camera offset from the target as (radius, polar, azimuth); azimuth already unwrapped to the shortest path. */
  fromS: THREE.Spherical;
  toS: THREE.Spherical;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  /** Orthographic only: animate camera.zoom to this value. */
  fromZoom: number;
  toZoom: number | null;
}

const FOV = 40;
/** Distance from the orbit poles used for Top / Bottom views (avoids the up-vector singularity). */
const POLE_EPS = 1e-4;
const HALF_PI = Math.PI / 2;

/**
 * three.js scene for one schematic at a time. Owns renderer/camera/controls and
 * the helpers (grid, bounds, layer frame, hover box); the geometry itself lives in
 * the model's LayerView, so view-state changes only restyle layers (setStyles).
 * Renders on demand: controls changes, hover, tweens and damping.
 */
export class SchematicScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1000);
  private orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 1000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.persp;
  /** Half of the visible world height of the orthographic camera at zoom 1. */
  private orthoHalf = 10;
  private homeDist = 10;
  private cube: ViewCube;
  private resizeRaf = 0;
  private controls: OrbitControls;
  private ro: ResizeObserver;
  private model: SchematicModel | null = null;
  private helpers = new THREE.Group();
  private grid: THREE.GridHelper | null = null;
  /** 1x1x1 cell lattice of the current layer (geometry reused, only position.y changes). */
  private lattice: THREE.Group | null = null;
  private latticeMats: LineMaterial[] = [];
  private tickLayer: HTMLElement;
  private tickLabels: Array<{ el: HTMLElement; pos: THREE.Vector3 }> = [];
  private frameOutline: THREE.LineSegments | null = null;
  private hoverBox: THREE.LineSegments;
  private raycaster = new THREE.Raycaster();
  private targets: THREE.Object3D[] = [];
  private view: SceneView = {
    mode: "layers",
    layer: 0,
    below: "dim",
    showAbove: true,
    grid: true,
  };
  private homePos = new THREE.Vector3();
  private homeTarget = new THREE.Vector3();
  private tween: Tween | null = null;
  private pole: "top" | "bottom" | null = null;
  // WASD fly: smoothed intent (x = right, y = up, z = forward), runs its own rAF only while active.
  private moveIn = { f: 0, r: 0, u: 0, fast: false };
  private moveVel = new THREE.Vector3();
  private moveRaf = 0;
  private moveLast = 0;
  private diag = 20;
  private raf = 0;
  private hoverRaf = 0;
  private pointer: { x: number; y: number } | null = null;
  private lastHoverKey = "";
  private disposed = false;
  private width = 1;
  private height = 1;
  private cleanups: Array<() => void> = [];

  // Measuring tape. Objects and labels are rebuilt from this state on change.
  private tapeOn = false;
  private tapePending: TapePoint | null = null;
  private tapePreview: TapePoint | null = null;
  private tapePinned: TapeMeasure[] = [];
  private tapeSeq = 0;
  private tapeGroup = new THREE.Group();
  private tapeLabels: Array<{ el: HTMLElement; pos: THREE.Vector3 }> = [];
  private labelLayer: HTMLDivElement;
  private tapeAccent = new THREE.Color("#6cc349");
  private downAt: { x: number; y: number } | null = null;
  private plane = new THREE.Plane();
  private tmpV = new THREE.Vector3();

  constructor(
    private host: HTMLElement,
    private events: SceneEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    // Material icons render through this context, where the atlas texture already lives.
    setIconRenderer(this.renderer);
    const canvas = this.renderer.domElement;
    canvas.className = "schem-canvas";
    host.appendChild(canvas);

    this.scene.add(this.helpers);
    this.scene.add(this.tapeGroup);
    this.tapeAccent = cssColor("--mc-green-hi", "#6cc349");
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "schem-tape-layer";
    host.appendChild(this.labelLayer);
    this.tickLayer = document.createElement("div");
    this.tickLayer.className = "schem-tape-layer schem-tick-layer";
    host.appendChild(this.tickLayer);
    const hb = new THREE.BoxGeometry(1.012, 1.012, 1.012);
    this.hoverBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(hb),
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
    );
    hb.dispose();
    this.hoverBox.renderOrder = 10;
    this.hoverBox.visible = false;
    this.scene.add(this.hoverBox);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    // ~12% per wheel tick (0.95^zoomSpeed per 100 delta), toward the cursor.
    this.controls.zoomSpeed = 2.5;
    this.controls.enableZoom = true;
    if ("zoomToCursor" in this.controls) {
      (this.controls as OrbitControls & { zoomToCursor: boolean }).zoomToCursor = true;
    }
    this.controls.minZoom = 0.05;
    this.controls.maxZoom = 80;
    this.controls.addEventListener("change", () => this.requestRender());

    this.cube = new ViewCube(host, events.cubeLabels, cssColor("--mc-green-hi", "#6cc349"), {
      onSnap: (dir) => this.snapTo(dir),
      onOrbit: (dx, dy) => this.orbitBy(dx, dy),
    });

    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0) {
        this.setHover(null);
        return;
      }
      const r = canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.scheduleHover();
    };
    const onLeave = () => {
      this.pointer = null;
      this.setHover(null);
    };
    const onLeaveCanvas = () => {
      onLeave();
      this.setTapePreview(null);
    };
    // Tape: only a click without movement places a point (a drag orbits).
    const onDown = (e: PointerEvent) => {
      onLeave();
      this.downAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      const d = this.downAt;
      this.downAt = null;
      if (!d || !this.tapeOn || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4) return;
      const r = canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.tapeClick(e.shiftKey);
      this.scheduleHover();
    };
    const onCancel = () => {
      this.downAt = null;
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeaveCanvas);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    this.cleanups.push(
      () => canvas.removeEventListener("pointermove", onMove),
      () => canvas.removeEventListener("pointerleave", onLeaveCanvas),
      () => canvas.removeEventListener("pointerdown", onDown),
      () => canvas.removeEventListener("pointerup", onUp),
      () => canvas.removeEventListener("pointercancel", onCancel),
    );

    this.ro = new ResizeObserver(() => this.scheduleResize());
    this.ro.observe(host);
    this.resize();
  }

  /** Attach a freshly built model (the scene never owns/disposes its geometry). */
  setModel(model: SchematicModel) {
    this.clearModel();
    this.model = model;
    const [sx, sy, sz] = model.decoded.size;
    this.diag = Math.max(1, Math.sqrt(sx * sx + sy * sy + sz * sz));
    this.scene.add(model.view.group);

    const gridColor = cssColor("--mc-stone-hi", "#4a4a4a");
    const gridCenter = cssColor("--mc-green-hi", "#6cc349");
    const size = Math.max(sx, sz) + 4;
    this.grid = new THREE.GridHelper(size, size, gridCenter, gridColor);
    this.grid.position.set(sx / 2, -0.004, sz / 2);
    const gm = this.grid.material as THREE.LineBasicMaterial;
    gm.transparent = true;
    gm.opacity = 0.45;
    this.helpers.add(this.grid);

    this.buildLattice(sx, sz);

    const box = new THREE.BoxGeometry(sx, sy, sz);
    const bounds = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }),
    );
    box.dispose();
    bounds.position.set(sx / 2, sy / 2, sz / 2);
    this.helpers.add(bounds);

    const accent = cssColor("--mc-green-hi", "#6cc349");
    // Crisp outline of the current layer slab: rects at bottom and top + corner lines.
    const e = 0.002;
    const frameBox = new THREE.BoxGeometry(sx + 2 * e, 1 + 2 * e, sz + 2 * e);
    frameBox.translate(sx / 2, 0.5, sz / 2);
    this.frameOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(frameBox),
      new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.8 }),
    );
    frameBox.dispose();
    this.frameOutline.renderOrder = 2;
    this.helpers.add(this.frameOutline);

    this.controls.minDistance = 1.5;
    this.controls.maxDistance = Math.max(sx, sy, sz) * 8 + 20;
    this.persp.far = this.orthoCam.far = Math.max(sx, sy, sz) * 30 + 200;
    this.frameCamera();
    this.applyView(true);
  }

  /** Detach the current model and drop helper geometry (model itself is untouched). */
  clearModel() {
    this.setHover(null);
    this.resetTape();
    this.tween = null;
    if (this.model) this.scene.remove(this.model.view.group);
    this.model = null;
    this.targets = [];
    this.helpers.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
    this.helpers.clear();
    this.grid = this.frameOutline = this.lattice = null;
    this.latticeMats = [];
    this.tickLayer.replaceChildren();
    this.tickLabels = [];
    this.requestRender();
  }

  /**
   * Cell lattice for one layer: lines on the floor (y) and top (y+1) planes at every block
   * boundary plus verticals at every intersection. Every 5th / 10th line is stronger. Built at
   * y = 0; moving between layers only changes position.y. Big footprints get verticals at
   * the 5-block intersections only.
   */
  private buildLattice(sx: number, sz: number) {
    const big = sx > 128 || sz > 128;
    const accent = cssColor("--mc-green-hi", "#6cc349");
    // Saturated accent: a white-ish line vanished on light textures (planks, sandstone).
    const col = accent.clone();
    // Three line sets (normal / every 5th / every 10th) with plain material opacity: per-vertex
    // alpha on LineBasicMaterial did not render reliably.
    const tier = (i: number) => (i % 10 === 0 ? 2 : i % 5 === 0 ? 1 : 0);
    const sets: number[][] = [[], [], []];
    const seg = (a: number[], b: number[], t: number) => {
      sets[t].push(a[0], a[1], a[2], b[0], b[1], b[2]);
    };
    const y0 = 0.004;
    const y1 = 1.004;
    for (const y of [y0, y1]) {
      for (let z = 0; z <= sz; z++) seg([0, y, z], [sx, y, z], tier(z));
      for (let x = 0; x <= sx; x++) seg([x, y, 0], [x, y, sz], tier(x));
    }
    for (let x = 0; x <= sx; x++) {
      if (big && x % 5 !== 0) continue;
      for (let z = 0; z <= sz; z++) {
        if (big && z % 5 !== 0) continue;
        seg([x, y0, z], [x, y1, z], Math.max(tier(x), tier(z)));
      }
    }
    // Fat lines (pixel widths): plain GL lines are 1px and disappear on busy block textures.
    const width = [1.4, 2, 2.8];
    const opacity = [0.55, 0.8, 0.95];
    this.lattice = new THREE.Group();
    sets.forEach((pos, t) => {
      if (pos.length === 0) return;
      const g = new LineSegmentsGeometry();
      g.setPositions(pos);
      const mat = new LineMaterial({
        color: col.getHex(),
        linewidth: width[t],
        transparent: true,
        opacity: opacity[t],
        depthTest: true,
        depthWrite: false,
      });
      mat.resolution.set(this.width, this.height);
      this.latticeMats.push(mat);
      const lines = new LineSegments2(g, mat);
      lines.renderOrder = 4;
      lines.frustumCulled = false;
      this.lattice!.add(lines);
    });
    this.helpers.add(this.lattice);

    // Coordinate ticks every 5 blocks along the two front (south / east) floor edges.
    this.tickLayer.replaceChildren();
    this.tickLabels = [];
    const step = Math.max(5, Math.ceil(Math.max(sx, sz) / 60 / 5) * 5);
    const addTick = (p: THREE.Vector3, n: number) => {
      const el = document.createElement("div");
      el.className = "schem-grid-tick";
      el.style.visibility = "hidden";
      el.textContent = String(n);
      this.tickLayer.appendChild(el);
      this.tickLabels.push({ el, pos: p });
    };
    for (let x = step; x <= sx; x += step) addTick(new THREE.Vector3(x, 0, sz + 0.6), x);
    for (let z = step; z <= sz; z += step) addTick(new THREE.Vector3(sx + 0.6, 0, z), z);
  }

  setView(next: SceneView) {
    const prev = this.view;
    this.view = next;
    if (!this.model) return;
    const styleChanged =
      prev.mode !== next.mode ||
      prev.layer !== next.layer ||
      prev.below !== next.below ||
      prev.showAbove !== next.showAbove;
    this.applyView(styleChanged);
  }

  resetCamera() {
    if (!this.model) return;
    const zoom = this.camera === this.orthoCam ? this.orthoHalf / (this.homeDist * Math.tan((FOV * Math.PI) / 360)) : null;
    this.tweenTo(this.homePos, this.homeTarget, zoom);
  }

  /** Switch between perspective and orthographic projection, keeping the framing. */
  setOrtho(on: boolean) {
    if (on === (this.camera === this.orthoCam)) return;
    const target = this.controls.target;
    const half = Math.tan((FOV * Math.PI) / 360);
    const off = this.camera.position.clone().sub(target);
    this.tween = null;
    if (on) {
      this.orthoHalf = Math.max(0.01, off.length() * half);
      this.orthoCam.zoom = 1;
      this.orthoCam.position.copy(this.persp.position);
      this.orthoCam.quaternion.copy(this.persp.quaternion);
      this.camera = this.orthoCam;
    } else {
      const dist = Math.max(0.01, this.orthoHalf / this.orthoCam.zoom / half);
      this.persp.position.copy(target).addScaledVector(off.normalize(), dist);
      this.persp.quaternion.copy(this.orthoCam.quaternion);
      this.camera = this.persp;
    }
    this.controls.object = this.camera;
    this.updateProjection();
    this.controls.update();
    this.setHover(null);
    this.requestRender();
  }

  dispose() {
    this.disposed = true;
    setIconRenderer(null);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.hoverRaf);
    cancelAnimationFrame(this.resizeRaf);
    cancelAnimationFrame(this.moveRaf);
    this.cube.dispose();
    this.cleanups.forEach((f) => f());
    this.labelLayer.remove();
    this.tickLayer.remove();
    this.ro.disconnect();
    this.clearModel();
    this.controls.dispose();
    this.hoverBox.geometry.dispose();
    (this.hoverBox.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ---------- measuring tape ----------

  setTape(on: boolean) {
    if (on === this.tapeOn) return;
    this.tapeOn = on;
    this.tapePending = null;
    this.tapePreview = null;
    this.renderer.domElement.style.cursor = on ? "crosshair" : "";
    this.tapeChanged();
  }

  /** Drop the measurement in progress. Returns false when there was none. */
  cancelTape(): boolean {
    if (!this.tapePending) return false;
    this.tapePending = null;
    this.tapePreview = null;
    this.tapeChanged();
    return true;
  }

  clearTape() {
    this.tapePending = null;
    this.tapePreview = null;
    this.tapePinned = [];
    this.tapeChanged();
  }

  removeMeasure(id: number) {
    this.tapePinned = this.tapePinned.filter((m) => m.id !== id);
    this.tapeChanged();
  }

  /** Measurements belong to one schematic: drop them when the model goes away. */
  private resetTape() {
    const had = this.tapePending !== null || this.tapePinned.length > 0;
    this.tapePending = null;
    this.tapePreview = null;
    this.tapePinned = [];
    this.rebuildTape();
    if (had && !this.disposed) this.events.onTape({ pinned: [], pending: false });
  }

  private tapeChanged() {
    this.rebuildTape();
    this.events.onTape({ pinned: this.tapePinned.slice(), pending: this.tapePending !== null });
  }

  private tapeClick(chain: boolean) {
    const p = this.pointer;
    if (!this.model || !p || this.tween) return;
    const cell = this.pickAt(p.x, p.y).cell;
    if (!cell) return;
    const a = this.tapePending;
    if (!a) {
      this.tapePending = cell;
    } else {
      this.tapePinned.push({ id: ++this.tapeSeq, a, b: cell });
      if (this.tapePinned.length > TAPE_MAX) this.tapePinned.shift();
      this.tapePending = chain ? cell : null;
    }
    this.tapePreview = null;
    this.tapeChanged();
  }

  private setTapePreview(cell: TapePoint | null) {
    if (!this.tapePending) return;
    const a = this.tapePreview;
    if (a === cell || (a && cell && a.x === cell.x && a.y === cell.y && a.z === cell.z)) return;
    this.tapePreview = cell;
    this.rebuildTape();
  }

  private rebuildTape() {
    this.tapeGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    this.tapeGroup.clear();
    this.labelLayer.replaceChildren();
    this.tapeLabels = [];
    if (this.tapeOn && this.model) {
      for (const m of this.tapePinned) this.addMeasure(m.a, m.b, false, m.id);
      const a = this.tapePending;
      if (a) {
        if (this.tapePreview) this.addMeasure(a, this.tapePreview, true);
        else this.addMarker(a);
      }
    }
    this.requestRender();
  }

  private addMarker(c: TapePoint) {
    const g = new THREE.BoxGeometry(1.1, 1.1, 1.1);
    const marker = new THREE.LineSegments(
      new THREE.EdgesGeometry(g),
      new THREE.LineBasicMaterial({ color: this.tapeAccent, depthTest: false, transparent: true }),
    );
    g.dispose();
    marker.position.set(c.x + 0.5, c.y + 0.5, c.z + 0.5);
    marker.renderOrder = 12;
    this.tapeGroup.add(marker);
  }

  private addMeasure(a: TapePoint, b: TapePoint, live: boolean, id?: number) {
    const met = tapeMetrics(a, b);
    const [sx, sy, sz] = met.size;
    const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
    const hi = { x: lo.x + sx, y: lo.y + sy, z: lo.z + sz };
    const color = 0xffd24a;
    this.addMarker(a);
    if (a.x !== b.x || a.y !== b.y || a.z !== b.z) this.addMarker(b);

    if (sx * sy * sz > 1) {
      const bg = new THREE.BoxGeometry(sx + 0.04, sy + 0.04, sz + 0.04);
      bg.translate(lo.x + sx / 2, lo.y + sy / 2, lo.z + sz / 2);
      const box = new THREE.LineSegments(
        new THREE.EdgesGeometry(bg),
        live
          ? new THREE.LineDashedMaterial({
              color,
              dashSize: 0.3,
              gapSize: 0.2,
              depthTest: false,
              transparent: true,
              opacity: 0.9,
            })
          : new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }),
      );
      bg.dispose();
      if (live) box.computeLineDistances();
      box.renderOrder = 11;
      this.tapeGroup.add(box);

      const lg = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x + 0.5, a.y + 0.5, a.z + 0.5),
        new THREE.Vector3(b.x + 0.5, b.y + 0.5, b.z + 0.5),
      ]);
      const line = new THREE.Line(
        lg,
        new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
      );
      line.renderOrder = 11;
      this.tapeGroup.add(line);
    }

    const mid = new THREE.Vector3(
      (a.x + b.x) / 2 + 0.5,
      (a.y + b.y) / 2 + 0.5,
      (a.z + b.z) / 2 + 0.5,
    );
    const { main, sub } = tapeLabel(met);
    this.addLabel(mid, main, sub, live ? undefined : id);

    if (!met.straight) {
      const cx = lo.x + sx / 2;
      const cy = lo.y + sy / 2;
      const cz = lo.z + sz / 2;
      if (sx > 1) this.addLabel(new THREE.Vector3(cx, lo.y, hi.z), String(sx));
      if (sz > 1) this.addLabel(new THREE.Vector3(hi.x, lo.y, cz), String(sz));
      if (sy > 1) this.addLabel(new THREE.Vector3(hi.x, cy, hi.z), String(sy));
    }
  }

  /** HTML label pinned to a world point; id adds a delete button. Edge labels have no sub line. */
  private addLabel(pos: THREE.Vector3, main: string, sub?: string, id?: number) {
    const el = document.createElement("div");
    el.className = sub === undefined ? "schem-tape-label is-edge" : "schem-tape-label";
    el.style.visibility = "hidden";
    const strong = document.createElement("strong");
    strong.textContent = main;
    el.appendChild(strong);
    if (sub !== undefined) {
      const small = document.createElement("span");
      small.textContent = sub;
      el.appendChild(small);
    }
    if (id !== undefined) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "schem-tape-x";
      x.textContent = "✕";
      x.title = t("schematics.tape.remove");
      x.setAttribute("aria-label", t("schematics.tape.remove"));
      x.addEventListener("click", () => this.removeMeasure(id));
      el.appendChild(x);
    }
    this.labelLayer.appendChild(el);
    this.tapeLabels.push({ el, pos });
  }

  /** Re-project labels after each render; hide those behind the camera. */
  private updateLabels() {
    this.projectLabels(this.tapeLabels);
    if (this.lattice?.visible) this.projectLabels(this.tickLabels);
  }

  private projectLabels(labels: Array<{ el: HTMLElement; pos: THREE.Vector3 }>) {
    if (labels.length === 0) return;
    const cam = this.camera;
    const v = this.tmpV;
    for (const l of labels) {
      v.copy(l.pos).applyMatrix4(cam.matrixWorldInverse);
      if (v.z >= -1e-3) {
        l.el.style.visibility = "hidden";
        continue;
      }
      v.applyMatrix4(cam.projectionMatrix);
      if (Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
        l.el.style.visibility = "hidden";
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * this.width;
      const y = (-v.y * 0.5 + 0.5) * this.height;
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      l.el.style.visibility = "visible";
    }
  }

  // ---------- internals ----------

  private applyView(restyle: boolean) {
    const m = this.model;
    if (!m) return;
    const v = this.view;
    const sy = m.decoded.size[1];
    const cur = Math.min(Math.max(v.layer, 0), sy - 1);
    if (restyle) {
      m.view.setStyles((y) => {
        if (v.mode === "whole") return "normal";
        if (y === cur) return "normal";
        if (y < cur) return v.below === "dim" ? "dimmed" : v.below === "hide" ? "hidden" : "normal";
        return v.showAbove ? "ghost" : "hidden";
      });
      this.targets = m.view.raycastTargets();
      this.setHover(null);
    }
    const layerMode = v.mode === "layers";
    if (this.grid) this.grid.visible = v.grid && !layerMode;
    if (this.lattice) {
      this.lattice.visible = v.grid && layerMode;
      this.lattice.position.y = cur;
    }
    for (const l of this.tickLabels) l.pos.y = cur;
    this.tickLayer.style.display = v.grid && layerMode ? "" : "none";
    const showFrame = v.mode === "layers";
    if (this.frameOutline) {
      this.frameOutline.visible = showFrame;
      this.frameOutline.position.y = cur;
    }
    this.requestRender();
  }

  private frameCamera() {
    const m = this.model!;
    const [sx, sy, sz] = m.decoded.size;
    const center = new THREE.Vector3(sx / 2, sy / 2, sz / 2);
    const radius = Math.sqrt(sx * sx + sy * sy + sz * sz) / 2;
    let dist = (radius / Math.sin((FOV * Math.PI) / 360)) * 0.9;
    if (this.persp.aspect < 1) dist /= this.persp.aspect;
    const dir = new THREE.Vector3(1, 0.85, 1.25).normalize();
    this.homeDist = dist;
    this.homeTarget.copy(center);
    this.homePos.copy(center).addScaledVector(dir, dist);
    this.persp.near = Math.max(0.05, dist / 500);
    this.camera.position.copy(this.homePos);
    this.controls.target.copy(this.homeTarget);
    if (this.camera === this.orthoCam) {
      this.orthoHalf = dist * Math.tan((FOV * Math.PI) / 360);
      this.orthoCam.zoom = 1;
    }
    this.updateProjection();
    this.controls.update();
  }

  /** Keep both cameras' projection in sync with the host size. */
  private updateProjection() {
    const aspect = this.width / this.height;
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    const o = this.orthoCam;
    o.top = this.orthoHalf;
    o.bottom = -this.orthoHalf;
    o.left = -this.orthoHalf * aspect;
    o.right = this.orthoHalf * aspect;
    o.updateProjectionMatrix();
  }

  /** Camera offset from the orbit target as spherical coordinates. */
  private camSpherical(): THREE.Spherical {
    return new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
  }

  /** Animate the camera to look at the target from `dir` (unit, target -> camera). */
  private snapTo(dir: THREE.Vector3) {
    if (!this.model) return;
    const cur = this.camSpherical();
    const sph = new THREE.Spherical(cur.radius, 0, cur.theta);
    if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.z) < 1e-6) {
      // Top / Bottom: keep the heading, only move to the pole so the image does not spin.
      sph.phi = dir.y > 0 ? POLE_EPS : Math.PI - POLE_EPS;
    } else {
      const d = dir.clone().normalize();
      sph.phi = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1));
      sph.theta = Math.atan2(d.x, d.z);
    }
    this.tweenSpherical(sph);
  }

  /**
   * Orbit-arrow step in screen space: the camera moves to the face that sits on that side of the
   * screen (`dx` = +1 right, `dy` = -1 up). From Top / Bottom, left / right therefore go to a side
   * face instead of spinning, and up keeps cycling (side → Top → opposite side → Top …), so an
   * arrow never gets stuck. Repeated clicks chain from the running tween's destination.
   */
  orbitStep(dx: number, dy: number) {
    if (!this.model) return;
    const s = this.tween ? this.tween.toS.clone() : this.camSpherical();
    const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, s.phi, s.theta));
    // Camera basis for that direction with OrbitControls' world-up (matches what the screen shows).
    const right = new THREE.Vector3(0, 1, 0).cross(dir);
    if (right.lengthSq() < 1e-8) {
      // Exactly at a pole: the limit of up × dir, which only depends on the heading.
      right.set(Math.cos(s.theta), 0, -Math.sin(s.theta));
    }
    right.normalize();
    const up = dir.clone().cross(right).normalize();
    const next = dx !== 0 ? right.multiplyScalar(dx) : up.multiplyScalar(-dy);
    // Land exactly on the nearest face.
    const ax = Math.abs(next.x);
    const ay = Math.abs(next.y);
    const az = Math.abs(next.z);
    const face =
      ay >= ax && ay >= az
        ? new THREE.Vector3(0, Math.sign(next.y), 0)
        : ax >= az
          ? new THREE.Vector3(Math.sign(next.x), 0, 0)
          : new THREE.Vector3(0, 0, Math.sign(next.z));
    if (face.y !== 0) {
      // Going to Top / Bottom: keep the heading so the picture does not spin.
      this.tweenSpherical(new THREE.Spherical(s.radius, face.y > 0 ? POLE_EPS : Math.PI - POLE_EPS, s.theta));
    } else {
      this.tweenSpherical(new THREE.Spherical(s.radius, HALF_PI, Math.atan2(face.x, face.z)));
    }
  }

  /** Roll arrows (Top / Bottom only): rotate the heading by 90 degrees, so the map turns in 90 degree steps. */
  rollStep(dir: 1 | -1) {
    if (!this.model || !this.pole) return;
    const s = this.tween ? this.tween.toS.clone() : this.camSpherical();
    // Turning the heading by +90° spins a top-down map clockwise on screen; mirrored from below.
    const sense = this.pole === "top" ? dir : -dir;
    const k = Math.round(s.theta / HALF_PI) + sense;
    this.tweenSpherical(new THREE.Spherical(s.radius, s.phi, k * HALF_PI));
  }

  /** Orbit by a pointer drag on the view cube (CSS pixels). */
  private orbitBy(dx: number, dy: number) {
    this.tween = null;
    const target = this.controls.target;
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target));
    sph.theta -= dx * 0.012;
    sph.phi = Math.min(Math.PI - 1e-4, Math.max(1e-4, sph.phi - dy * 0.012));
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
    this.camera.lookAt(target);
    this.controls.update();
    this.requestRender();
  }

  private tweenTo(pos: THREE.Vector3, target: THREE.Vector3, zoom: number | null) {
    const fromTarget = this.controls.target.clone();
    const fromPos = this.camera.position.clone();
    const fromS = new THREE.Spherical().setFromVector3(fromPos.clone().sub(fromTarget));
    const toS = new THREE.Spherical().setFromVector3(pos.clone().sub(target));
    this.startTween(fromS, toS, fromPos, pos, fromTarget, target, zoom);
  }

  /** Tween to a camera offset given in spherical coordinates around the current target. */
  private tweenSpherical(to: THREE.Spherical) {
    const target = this.controls.target.clone();
    const pos = target.clone().add(new THREE.Vector3().setFromSpherical(to));
    this.startTween(this.camSpherical(), to, this.camera.position.clone(), pos, target, target, null);
  }

  private startTween(
    fromS: THREE.Spherical,
    toS: THREE.Spherical,
    fromPos: THREE.Vector3,
    toPos: THREE.Vector3,
    fromTarget: THREE.Vector3,
    toTarget: THREE.Vector3,
    zoom: number | null,
  ) {
    // Always take the shortest azimuth path.
    const TAU = Math.PI * 2;
    const dTheta = ((((toS.theta - fromS.theta + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    const to = new THREE.Spherical(toS.radius, toS.phi, fromS.theta + dTheta);
    this.tween = {
      fromZoom: this.camera.zoom,
      toZoom: zoom,
      t0: performance.now(),
      dur: 300,
      fromS: fromS.clone(),
      toS: to,
      fromPos,
      toPos: toPos.clone(),
      fromTarget,
      toTarget: toTarget.clone(),
    };
    this.requestRender();
  }

  /**
   * WASD fly input (forward / right / up in -1..1). Perspective: moves camera and orbit target together.
   * Orthographic: forward / back zooms, the rest pans. Pass zeros to stop (the loop eases out and ends).
   */
  setMoveInput(f: number, r: number, u: number, fast: boolean) {
    this.moveIn = { f, r, u, fast };
    if ((f || r || u) && !this.moveRaf && !this.disposed) {
      this.tween = null;
      this.moveLast = performance.now();
      this.moveRaf = requestAnimationFrame(() => this.moveStep());
    }
  }

  private moveStep() {
    this.moveRaf = 0;
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.moveLast) / 1000);
    this.moveLast = now;
    const { f, r, u, fast } = this.moveIn;
    const mult = fast ? 3 : 1;
    const want = new THREE.Vector3(r, u, f).multiplyScalar(mult);
    this.moveVel.lerp(want, 1 - Math.exp(-dt * 9));
    const v = this.moveVel;
    const idle = !f && !r && !u;
    if (idle && v.lengthSq() < 1e-4) {
      v.set(0, 0, 0);
      return;
    }
    if (this.model && dt > 0) {
      const ortho = this.camera === this.orthoCam;
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 0.01) {
        // Looking along the vertical axis: "forward" is the screen's up direction.
        fwd.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
        fwd.y = 0;
      }
      fwd.normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const delta = new THREE.Vector3().addScaledVector(right, v.x).addScaledVector(new THREE.Vector3(0, 1, 0), v.y);
      if (ortho) {
        const span = (2 * this.orthoHalf) / this.orthoCam.zoom;
        delta.multiplyScalar(span * 0.5 * dt);
        const z = THREE.MathUtils.clamp(
          this.orthoCam.zoom * Math.exp(v.z * 1.2 * dt),
          this.controls.minZoom,
          this.controls.maxZoom,
        );
        this.orthoCam.zoom = z;
        this.orthoCam.updateProjectionMatrix();
      } else {
        delta.addScaledVector(fwd, v.z).multiplyScalar((this.diag / 4) * dt);
      }
      this.camera.position.add(delta);
      this.controls.target.add(delta);
      this.setHover(null);
      this.requestRender();
    }
    this.moveRaf = requestAnimationFrame(() => this.moveStep());
  }

  private setHover(info: HoverInfo | null) {
    const key = info ? `${info.pick.x},${info.pick.y},${info.pick.z}` : "";
    if (!info) {
      if (this.hoverBox.visible) {
        this.hoverBox.visible = false;
        this.requestRender();
      }
      if (this.lastHoverKey !== "") {
        this.lastHoverKey = "";
        this.events.onHover(null);
      }
      return;
    }
    this.hoverBox.position.set(info.pick.x + 0.5, info.pick.y + 0.5, info.pick.z + 0.5);
    if (!this.hoverBox.visible) this.hoverBox.visible = true;
    this.lastHoverKey = key;
    this.events.onHover(info);
    this.requestRender();
  }

  private scheduleHover() {
    if (this.hoverRaf) return;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      this.updateHover();
    });
  }

  private updateHover() {
    const m = this.model;
    const p = this.pointer;
    if (!m || !p || this.disposed || this.tween) {
      this.setHover(null);
      this.setTapePreview(null);
      return;
    }
    const { pick, cell } = this.pickAt(p.x, p.y);
    this.setHover(pick ? { pick, x: p.x, y: p.y } : null);
    this.setTapePreview(cell);
  }

  /**
   * Block under the pointer (`pick`) and the tape target (`cell`): the picked block or,
   * in layer mode with the tape on and nothing hit, the cell on the current layer's plane.
   */
  private pickAt(px: number, py: number): { pick: PickResult | null; cell: TapePoint | null } {
    const m = this.model;
    if (!m) return { pick: null, cell: null };
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.targets, false)[0];
    let pick: PickResult | null = null;
    if (hit && hit.face) {
      const r = pickBlock(m.decoded, hit.point, hit.face.normal);
      if (r && r.paletteId !== 0) pick = r;
    }
    if (pick) return { pick, cell: { x: pick.x, y: pick.y, z: pick.z } };
    if (!this.tapeOn || this.view.mode !== "layers") return { pick: null, cell: null };
    const [sx, sy, sz] = m.decoded.size;
    const cur = Math.min(Math.max(this.view.layer, 0), sy - 1);
    this.plane.set(new THREE.Vector3(0, 1, 0), -(cur + 0.5));
    const pt = this.raycaster.ray.intersectPlane(this.plane, this.tmpV);
    if (!pt) return { pick: null, cell: null };
    const x = Math.floor(pt.x);
    const z = Math.floor(pt.z);
    if (x < 0 || z < 0 || x >= sx || z >= sz) return { pick: null, cell: null };
    return { pick: null, cell: { x, y: cur, z } };
  }

  /** rAF-throttled: the host's size depends only on the window / panels, never on the canvas. */
  private scheduleResize() {
    if (this.resizeRaf || this.disposed) return;
    this.resizeRaf = requestAnimationFrame(() => {
      this.resizeRaf = 0;
      this.resize();
    });
  }

  private resize() {
    if (this.disposed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    for (const m of this.latticeMats) m.resolution.set(w, h);
    this.updateProjection();
    // setSize clears the canvas: draw in the same task so it never flashes blank.
    if (this.raf) cancelAnimationFrame(this.raf);
    this.frame();
  }

  private updatePole() {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = off.length();
    const c = len > 1e-9 ? off.y / len : 0;
    // Within ~1 degree of straight up / down.
    const next = c > 0.99985 ? "top" : c < -0.99985 ? "bottom" : null;
    if (next === this.pole) return;
    this.pole = next;
    this.events.onPole?.(next);
  }

  private requestRender() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => this.frame());
  }

  private frame() {
    this.raf = 0;
    if (this.disposed) return;
    let again = false;
    if (this.tween) {
      const tw = this.tween;
      const k = Math.min(1, (performance.now() - tw.t0) / tw.dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      // Interpolate in spherical coordinates (radius / polar / azimuth): no flips through the poles.
      if (tw.fromS.radius > 1e-6 && tw.toS.radius > 1e-6) {
        const sph = new THREE.Spherical(
          tw.fromS.radius + (tw.toS.radius - tw.fromS.radius) * e,
          tw.fromS.phi + (tw.toS.phi - tw.fromS.phi) * e,
          tw.fromS.theta + (tw.toS.theta - tw.fromS.theta) * e,
        );
        this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      } else {
        this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      }
      if (tw.toZoom !== null && this.camera === this.orthoCam) {
        this.camera.zoom = tw.fromZoom + (tw.toZoom - tw.fromZoom) * e;
        this.camera.updateProjectionMatrix();
      }
      if (k >= 1) this.tween = null;
      again = true;
    }
    if (this.controls.update()) again = true;
    this.renderer.render(this.scene, this.camera);
    this.cube.update(this.camera.quaternion);
    this.updatePole();
    this.updateLabels();
    if (again) this.requestRender();
  }
}
