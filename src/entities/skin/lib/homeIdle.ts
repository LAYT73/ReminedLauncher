import { PlayerAnimation } from "skinview3d";
import type { PlayerObject } from "skinview3d";

/**
 * Home-only idle: continuous base layer (breathing, weight shift, arm sway, eased head glances)
 * plus occasional one-shot fidgets. All motion is time-based (seconds) and relative to the rest pose.
 * Rotations in radians. Arm convention: x < 0 swings forward/up; z outward = + (left) / - (right).
 */

type Pose = {
  hx: number; hy: number; hz: number;
  bx: number; by: number; bz: number;
  lax: number; laz: number; rax: number; raz: number;
  llx: number; llz: number; rlx: number; rlz: number;
};

type Fidget = {
  name: string;
  /** Total duration in seconds (includes blend in/out). */
  duration: [number, number];
  /** t = seconds since start, d = duration, w = blend weight 0..1, dir = random ±1. */
  apply: (pose: Pose, t: number, d: number, w: number, dir: number) => void;
};

const TAU = Math.PI * 2;
const BLEND = 0.42;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const sinHz = (t: number, hz: number, ph = 0) => Math.sin(t * TAU * hz + ph);
/** Smooth 0→1→0 plateau within [0,d] with ramps of `r` seconds. */
const plateau = (t: number, d: number, r: number) => smooth(t / r) * smooth((d - t) / r);

const FIDGETS: Fidget[] = [
  {
    // look at own hand: right arm lifts in front, head tips down toward it, slow wrist-like turn
    name: "lookHand",
    duration: [2.4, 3.0],
    apply: (p, t, _d, w) => {
      p.rax += -0.95 * w;
      p.raz += 0.12 * w + sinHz(t, 0.5) * 0.05 * w;
      p.hx += 0.26 * w;
      p.hy += -0.3 * w;
      p.bx += 0.02 * w;
    },
  },
  {
    // stretch both arms up, slight back arch, look up, tiny tremble at the peak
    name: "stretch",
    duration: [2.8, 3.5],
    apply: (p, t, _d, w) => {
      const tremble = sinHz(t, 7) * 0.012 * w;
      p.lax += -2.55 * w + tremble;
      p.rax += -2.55 * w - tremble;
      p.laz += 0.28 * w;
      p.raz += -0.28 * w;
      p.hx += -0.28 * w;
      p.bx += -0.07 * w;
      p.llx += 0.02 * w;
      p.rlx += 0.02 * w;
    },
  },
  {
    // small wave with the right arm
    name: "wave",
    duration: [2.2, 2.8],
    apply: (p, t, d, w) => {
      const lift = smooth((t - 0.1) / 0.5) * smooth((d - t - 0.1) / 0.5);
      p.raz += -2.3 * lift + sinHz(t, 2.2) * 0.2 * lift;
      p.rax += -0.25 * lift;
      p.hz += -0.07 * w;
      p.hy += -0.14 * w;
      p.bz += -0.015 * w;
    },
  },
  {
    // cross arms in front for a moment
    name: "crossArms",
    duration: [2.6, 3.4],
    apply: (p, t, _d, w) => {
      const settle = sinHz(t, 0.35) * 0.015 * w;
      p.lax += -1.05 * w + settle;
      p.rax += -1.15 * w - settle;
      p.laz += -0.62 * w;
      p.raz += 0.62 * w;
      p.hx += 0.04 * w;
      p.bx += 0.015 * w;
    },
  },
  {
    // tap right foot a few times, glance down at it
    name: "tapFoot",
    duration: [2.4, 3.2],
    apply: (p, t, d, w) => {
      const tap = Math.pow(Math.max(0, sinHz(t, 1.9)), 2) * plateau(t, d, 0.5);
      p.rlx += -0.1 * w - 0.14 * tap;
      p.bz += 0.012 * w;
      p.hx += 0.14 * w;
      p.hy += 0.12 * w;
    },
  },
  {
    // scratch back of the head with the right hand
    name: "scratchHead",
    duration: [2.4, 3.0],
    apply: (p, t, d, w) => {
      const scratch = sinHz(t, 3.2) * 0.06 * plateau(t, d, 0.6);
      p.rax += -2.45 * w + scratch;
      p.raz += 0.22 * w;
      p.hz += -0.09 * w;
      p.hx += 0.05 * w;
      p.bz += 0.01 * w;
    },
  },
  {
    // glance back over the shoulder (random side), body twists a little
    name: "lookBack",
    duration: [2.8, 3.5],
    apply: (p, t, _d, w, dir) => {
      const settle = sinHz(t, 0.45) * 0.04 * w;
      p.hy += dir * (0.95 * w + settle);
      p.by += dir * 0.3 * w;
      p.hx += -0.04 * w;
      p.laz += dir * 0.03 * w;
    },
  },
  {
    // check surroundings: sweep one way, pause, sweep the other
    name: "lookAround",
    duration: [3.0, 3.6],
    apply: (p, t, d, w, dir) => {
      const u = clamp01(t / d);
      const sweep = smooth((u - 0.15) / 0.3) - 2 * smooth((u - 0.5) / 0.3) + smooth((u - 0.82) / 0.15);
      p.hy += dir * 0.62 * sweep * w;
      p.hx += -0.06 * w + 0.05 * sweep * w;
      p.by += dir * 0.07 * sweep * w;
    },
  },
];

export type HomeIdleOptions = {
  /** Gentle breathing only; no glances and no fidgets. */
  reducedMotion?: boolean;
};

export class HomeIdleAnimation extends PlayerAnimation {
  private readonly reduced: boolean;
  private time = 0;
  private nextFidgetAt: number;
  private active: { fidget: Fidget; start: number; duration: number; dir: number } | null = null;
  private lastName = "";

  // head glance state (cascaded exponential smoothing = eased in/out)
  private glanceUntil = 0;
  private tgtY = 0;
  private tgtX = 0;
  private midY = 0;
  private midX = 0;
  private curY = 0;
  private curX = 0;
  // quick "head adjust" flick
  private flickAt: number;
  private flickStart = -10;
  private flickY = 0;
  private flickX = 0;
  private capeVel = 0;
  private capeOff = 0;
  private prevBodyX = 0;

  private readonly phase = {
    a: rand(0, TAU), b: rand(0, TAU), c: rand(0, TAU), d: rand(0, TAU), e: rand(0, TAU),
  };

  constructor(opts: HomeIdleOptions = {}) {
    super();
    this.reduced = !!opts.reducedMotion;
    this.nextFidgetAt = rand(3.5, 6);
    this.flickAt = rand(4, 9);
  }

  protected animate(player: PlayerObject, rawDelta: number): void {
    const dt = Math.min(Math.max(rawDelta, 0), 0.1);
    if (dt <= 0) return;
    this.time += dt;
    const t = this.time;
    const amp = this.reduced ? 0.55 : 1;
    const ph = this.phase;

    // ---- (a) base layer ----
    const breath = sinHz(t, 1 / 4.1, ph.a);
    const breathSlow = sinHz(t, 1 / 6.3, ph.b);
    const shift = sinHz(t, 1 / 9.5, ph.c) + 0.35 * sinHz(t, 1 / 5.2, ph.d); // weight shift
    const sway = sinHz(t, 1 / 7.1, ph.e);

    const pose: Pose = {
      hx: 0, hy: 0, hz: 0,
      bx: breath * 0.022 * amp,
      by: sinHz(t, 1 / 11, ph.b) * 0.025 * amp,
      bz: shift * 0.016 * amp,
      lax: (sinHz(t, 1 / 4.1, ph.a - 0.7) * 0.03 + sway * 0.035) * amp,
      rax: (sinHz(t, 1 / 4.1, ph.a - 0.9) * 0.03 - sway * 0.03) * amp,
      laz: (Math.PI * 0.022 + breath * 0.02 + breathSlow * 0.015) * amp,
      raz: (-Math.PI * 0.022 - breath * 0.02 - breathSlow * 0.015) * amp,
      llx: 0,
      llz: shift * 0.014 * amp,
      rlx: 0,
      rlz: shift * 0.014 * amp,
    };
    pose.hx = breath * 0.012 * amp - pose.bx * 0.4;
    pose.hz = -pose.bz * 0.8 + sinHz(t, 1 / 8.3, ph.c) * 0.015 * amp;
    pose.hy = sinHz(t, 1 / 13, ph.d) * 0.06 * amp;

    // ---- eased glances + quick head adjust (full motion only) ----
    let fidgetW = 0;
    if (!this.reduced) {
      if (t >= this.glanceUntil) {
        this.glanceUntil = t + rand(2.2, 5);
        const still = Math.random() < 0.25;
        this.tgtY = still ? 0 : rand(-0.4, 0.4);
        this.tgtX = still ? 0 : rand(-0.1, 0.12);
      }
      const k1 = 1 - Math.exp(-dt * 2.6);
      const k2 = 1 - Math.exp(-dt * 3.4);
      this.midY += (this.tgtY - this.midY) * k1;
      this.midX += (this.tgtX - this.midX) * k1;
      this.curY += (this.midY - this.curY) * k2;
      this.curX += (this.midX - this.curX) * k2;

      if (t >= this.flickAt) {
        this.flickStart = t;
        this.flickAt = t + rand(5, 11);
        this.flickY = rand(-0.1, 0.1);
        this.flickX = rand(-0.06, 0.05);
      }
      const fu = (t - this.flickStart) / 0.38;
      const flick = fu >= 0 && fu <= 1 ? Math.sin(fu * Math.PI) : 0;

      // ---- (b) fidget scheduler ----
      if (!this.active && t >= this.nextFidgetAt) {
        const pool = FIDGETS.filter((f) => f.name !== this.lastName);
        const fidget = pool[Math.floor(Math.random() * pool.length)];
        const duration = rand(fidget.duration[0], fidget.duration[1]);
        this.active = { fidget, start: t, duration, dir: Math.random() < 0.5 ? -1 : 1 };
        this.lastName = fidget.name;
      }
      if (this.active) {
        const a = this.active;
        const lt = t - a.start;
        if (lt >= a.duration) {
          this.active = null;
          this.nextFidgetAt = t + rand(6, 12);
        } else {
          const w = smooth(lt / BLEND) * smooth((a.duration - lt) / BLEND);
          fidgetW = w;
        }
      }

      const glanceScale = 1 - fidgetW;
      pose.hy += (this.curY + flick * this.flickY) * glanceScale;
      pose.hx += (this.curX + flick * this.flickX) * glanceScale;
      pose.by += this.curY * 0.12 * glanceScale;

      if (this.active) {
        const a = this.active;
        const lt = t - a.start;
        a.fidget.apply(pose, lt, a.duration, fidgetW, a.dir);
      }
    }

    // ---- write pose ----
    const s = player.skin;
    s.head.rotation.set(pose.hx, pose.hy, pose.hz);
    s.body.rotation.set(pose.bx, pose.by, pose.bz);
    s.leftArm.rotation.set(pose.lax, 0, pose.laz);
    s.rightArm.rotation.set(pose.rax, 0, pose.raz);
    s.leftLeg.rotation.set(pose.llx, 0, pose.llz);
    s.rightLeg.rotation.set(pose.rlx, 0, pose.rlz);

    // ---- cape: damped follow of body pitch change + gentle breathing sway ----
    const bodyVel = (pose.bx - this.prevBodyX) / dt;
    this.prevBodyX = pose.bx;
    const kc = 1 - Math.exp(-dt * 4);
    this.capeVel += (bodyVel * 0.35 - this.capeVel) * kc;
    this.capeOff += (this.capeVel * 0.6 - this.capeOff) * kc;
    const cape = player.cape;
    cape.rotation.x =
      Math.PI * 0.06 + breath * 0.012 * amp + shift * 0.01 * amp + Math.max(-0.12, Math.min(0.12, this.capeOff))
      + Math.abs(pose.bx) * 0.3;
  }
}

export function createHomeIdle(opts: HomeIdleOptions = {}) {
  return new HomeIdleAnimation(opts);
}
