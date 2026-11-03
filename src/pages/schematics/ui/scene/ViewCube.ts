import * as THREE from "three";

export interface CubeLabels {
  top: string;
  bottom: string;
  north: string;
  south: string;
  west: string;
  east: string;
}

export interface ViewCubeEvents {
  /** Unit vector from the orbit target towards the wanted camera position. */
  onSnap: (dir: THREE.Vector3) => void;
  /** Pointer drag on the cube, in CSS pixels. */
  onOrbit: (dx: number, dy: number) => void;
}

export const VIEW_CUBE_SIZE = 112;
/** Width of the edge / corner pick zones (cube is 1 unit wide). */
const EDGE = 0.2;
/** Axis length from the cube centre to the ball centre. */
const AXIS_LEN = 0.98;
const BALL = 0.2;
/**
 * Orthographic half-extent. Everything (cube corners at 0.87, axis balls at AXIS_LEN + BALL / 2)
 * stays inside a sphere of this radius, so no orientation can push a label out of the frame.
 */
const HALF = AXIS_LEN + BALL * 0.75 + 0.06;

const AXES: Array<{ dir: THREE.Vector3; color: string; label: string }> = [
  { dir: new THREE.Vector3(1, 0, 0), color: "#e2504f", label: "X" },
  { dir: new THREE.Vector3(0, 1, 0), color: "#6cc349", label: "Y" },
  { dir: new THREE.Vector3(0, 0, 1), color: "#4f8ee2", label: "Z" },
];

function faceTexture(text: string, top: boolean, font: string): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = top ? "#55663f" : "#3d4249";
    g.fillRect(0, 0, n, n);
    // Bevel: light top-left, dark bottom-right, black outline (Minecraft button look).
    g.fillStyle = "rgba(255,255,255,0.10)";
    g.fillRect(0, 0, n, 14);
    g.fillRect(0, 0, 14, n);
    g.fillStyle = "rgba(0,0,0,0.28)";
    g.fillRect(0, n - 14, n, 14);
    g.fillRect(n - 14, 0, 14, n);
    g.strokeStyle = "#000";
    g.lineWidth = 10;
    g.strokeRect(5, 5, n - 10, n - 10);
    g.fillStyle = "#f4f4f4";
    g.textAlign = "center";
    g.textBaseline = "middle";
    let size = 46;
    g.font = `${size}px ${font}`;
    const label = text.toUpperCase();
    while (size > 20 && g.measureText(label).width > n - 44) {
      size -= 2;
      g.font = `${size}px ${font}`;
    }
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillText(label, n / 2 + 3, n / 2 + 5);
    g.fillStyle = "#f4f4f4";
    g.fillText(label, n / 2, n / 2 + 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function ballTexture(color: string, label: string | null): THREE.CanvasTexture {
  const n = 64;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  if (g) {
    g.beginPath();
    g.arc(n / 2, n / 2, n / 2 - 3, 0, Math.PI * 2);
    g.fillStyle = label ? color : "rgba(0,0,0,0)";
    g.fill();
    g.lineWidth = label ? 3 : 5;
    g.strokeStyle = label ? "rgba(0,0,0,0.7)" : color;
    g.stroke();
    if (label) {
      g.fillStyle = "#101010";
      g.font = "bold 36px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, n / 2, n / 2 + 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Ball {
  sprite: THREE.Sprite;
  dir: THREE.Vector3;
  positive: boolean;
}

/**
 * Navigation gizmo rendered by its own small renderer/canvas: a labelled cube plus Blender-style
 * axis balls. Mirrors the main camera's orientation through an orthographic camera sized so the
 * whole gizmo always fits. Hover highlights a face / edge / corner / axis ball, click snaps the
 * main camera there, dragging orbits. Renders only on demand.
 */
export class ViewCube {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 0.1, 10);
  private cube: THREE.Mesh;
  private highlight: THREE.Mesh;
  private balls: Ball[] = [];
  private axisLines: THREE.LineSegments;
  private raycaster = new THREE.Raycaster();
  private quat = new THREE.Quaternion(0.5, 0.5, 0.5, 0.5);
  private hoverDir: THREE.Vector3 | null = null;
  private hoverBall: Ball | null = null;
  private raf = 0;
  private disposed = false;
  private down: { x: number; y: number; lx: number; ly: number; drag: boolean } | null = null;
  private disposables: Array<{ dispose(): void }> = [];
  private cleanups: Array<() => void> = [];

  constructor(
    host: HTMLElement,
    labels: CubeLabels,
    private accent: THREE.Color,
    private events: ViewCubeEvents,
  ) {
    const font =
      getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(VIEW_CUBE_SIZE, VIEW_CUBE_SIZE, false);
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.className = "schem-cube-canvas";
    host.appendChild(canvas);

    // BoxGeometry material order: +x, -x, +y, -y, +z, -z (east, west, top, bottom, south, north).
    const faces: Array<[string, boolean]> = [
      [labels.east, false],
      [labels.west, false],
      [labels.top, true],
      [labels.bottom, false],
      [labels.south, false],
      [labels.north, false],
    ];
    const mats = faces.map(([text, top]) => {
      const map = faceTexture(text, top, font);
      const m = new THREE.MeshBasicMaterial({ map });
      this.disposables.push(map, m);
      return m;
    });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // Top / bottom labels read upright when looking from the south (default heading).
    this.disposables.push(geo);
    this.cube = new THREE.Mesh(geo, mats);
    this.scene.add(this.cube);

    // Axis lines from the centre; the parts inside the cube are hidden by depth.
    const pos: number[] = [];
    const col: number[] = [];
    for (const a of AXES) {
      const c = new THREE.Color(a.color);
      const tip = a.dir.clone().multiplyScalar(AXIS_LEN - BALL / 2);
      pos.push(0, 0, 0, tip.x, tip.y, tip.z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    lg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const lm = new THREE.LineBasicMaterial({ vertexColors: true });
    this.disposables.push(lg, lm);
    this.axisLines = new THREE.LineSegments(lg, lm);
    this.scene.add(this.axisLines);

    for (const a of AXES) {
      for (const positive of [true, false]) {
        const map = ballTexture(a.color, positive ? a.label : null);
        const mat = new THREE.SpriteMaterial({ map, depthTest: false, transparent: true });
        this.disposables.push(map, mat);
        const sprite = new THREE.Sprite(mat);
        const dir = a.dir.clone().multiplyScalar(positive ? 1 : -1);
        sprite.position.copy(dir).multiplyScalar(AXIS_LEN);
        sprite.scale.setScalar(positive ? BALL : BALL * 0.8);
        this.scene.add(sprite);
        this.balls.push({ sprite, dir, positive });
      }
    }

    const hg = new THREE.BoxGeometry(1, 1, 1);
    const hm = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55, depthWrite: false });
    this.disposables.push(hg, hm);
    this.highlight = new THREE.Mesh(hg, hm);
    this.highlight.renderOrder = 2;
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    const ndcAt = (cx: number, cy: number): THREE.Vector2 | null => {
      const r = canvas.getBoundingClientRect();
      if (r.width <= 0) return null;
      return new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    };
    const pickAt = (cx: number, cy: number): { dir: THREE.Vector3; ball: Ball | null } | null => {
      const ndc = ndcAt(cx, cy);
      if (!ndc) return null;
      this.raycaster.setFromCamera(ndc, this.camera);
      // Balls first (drawn on top), front-most first.
      const ballHits = this.raycaster.intersectObjects(
        this.balls.map((b) => b.sprite),
        false,
      );
      for (const h of ballHits) {
        const ball = this.balls.find((b) => b.sprite === h.object);
        if (ball && this.ballFacing(ball) > -0.2) return { dir: ball.dir.clone(), ball };
      }
      const hit = this.raycaster.intersectObject(this.cube, false)[0];
      if (!hit) return null;
      const lim = 0.5 - EDGE;
      const d = new THREE.Vector3(
        hit.point.x > lim ? 1 : hit.point.x < -lim ? -1 : 0,
        hit.point.y > lim ? 1 : hit.point.y < -lim ? -1 : 0,
        hit.point.z > lim ? 1 : hit.point.z < -lim ? -1 : 0,
      );
      return d.lengthSq() === 0 ? null : { dir: d, ball: null };
    };

    const onMove = (e: PointerEvent) => {
      const dn = this.down;
      if (dn) {
        if (!dn.drag && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 4) {
          dn.drag = true;
          this.setHover(null);
        }
        if (dn.drag) {
          this.events.onOrbit(e.clientX - dn.lx, e.clientY - dn.ly);
          dn.lx = e.clientX;
          dn.ly = e.clientY;
        }
        return;
      }
      this.setHover(pickAt(e.clientX, e.clientY));
    };
    const onLeave = () => {
      if (!this.down) this.setHover(null);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, drag: false };
    };
    const onUp = (e: PointerEvent) => {
      const dn = this.down;
      this.down = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (dn && !dn.drag && e.type === "pointerup") {
        const p = pickAt(e.clientX, e.clientY);
        if (p) this.events.onSnap(p.dir.clone().normalize());
      }
      this.setHover(pickAt(e.clientX, e.clientY));
    };
    const onWheel = (e: WheelEvent) => e.preventDefault();
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    this.cleanups.push(
      () => canvas.removeEventListener("pointermove", onMove),
      () => canvas.removeEventListener("pointerleave", onLeave),
      () => canvas.removeEventListener("pointerdown", onDown),
      () => canvas.removeEventListener("pointerup", onUp),
      () => canvas.removeEventListener("pointercancel", onUp),
      () => canvas.removeEventListener("wheel", onWheel),
    );
    this.renderNow();
  }

  /** Mirror the main camera orientation; re-renders only when it changed. */
  update(q: THREE.Quaternion) {
    if (this.disposed || this.quat.equals(q)) return;
    this.quat.copy(q);
    this.renderNow();
  }

  /** > 0 when the ball points towards the viewer, < 0 when it is behind the cube. */
  private ballFacing(b: Ball): number {
    return b.dir.clone().applyQuaternion(this.quat.clone().invert()).z;
  }

  private setHover(p: { dir: THREE.Vector3; ball: Ball | null } | null) {
    const d = p && !p.ball ? p.dir : null;
    const ball = p?.ball ?? null;
    const same =
      ball === this.hoverBall &&
      ((!d && !this.hoverDir) || (d !== null && this.hoverDir !== null && d.equals(this.hoverDir)));
    if (same) return;
    this.hoverDir = d;
    this.hoverBall = ball;
    if (!d) {
      this.highlight.visible = false;
    } else {
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      for (const a of ["x", "y", "z"] as const) {
        const v = d[a];
        size[a] = (v === 0 ? 1 - 2 * EDGE : EDGE) + 0.014;
        center[a] = v * (0.5 - EDGE / 2 + 0.004);
      }
      this.highlight.scale.copy(size);
      this.highlight.position.copy(center);
      this.highlight.visible = true;
    }
    this.renderer.domElement.style.cursor = p ? "pointer" : "";
    this.requestRender();
  }

  private requestRender() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderNow();
    });
  }

  private renderNow() {
    if (this.disposed) return;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.camera.quaternion.copy(this.quat);
    this.camera.position.set(0, 0, 4).applyQuaternion(this.quat);
    this.camera.updateMatrixWorld();
    // Balls behind the cube fade; the hovered one lights up.
    for (const b of this.balls) {
      const facing = this.ballFacing(b);
      const mat = b.sprite.material;
      const hovered = b === this.hoverBall;
      mat.opacity = hovered ? 1 : facing < -0.15 ? 0.35 : 1;
      // Behind the cube: let the cube hide it instead of drawing over the faces.
      mat.depthTest = facing < -0.15 && !hovered;
      mat.color.set(hovered ? this.accent : 0xffffff);
      b.sprite.renderOrder = facing < 0 ? 1 : 4;
      b.sprite.scale.setScalar((b.positive ? BALL : BALL * 0.8) * (hovered ? 1.18 : 1));
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((f) => f());
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
