import { t } from "@/shared/i18n";

export interface TapePoint {
  x: number;
  y: number;
  z: number;
}

export interface TapeMeasure {
  id: number;
  a: TapePoint;
  b: TapePoint;
}

/** What the scene reports to the UI. */
export interface TapeState {
  pinned: TapeMeasure[];
  /** First point placed, waiting for the second. */
  pending: boolean;
}

export const TAPE_MAX = 5;

export interface TapeMetrics {
  /** Inclusive cuboid size in blocks (X, Y, Z). */
  size: [number, number, number];
  /** Offsets between block centers. */
  delta: [number, number, number];
  /** Straight distance between block centers. */
  dist: number;
  /** Only one axis is longer than one block. */
  straight: boolean;
}

export function tapeMetrics(a: TapePoint, b: TapePoint): TapeMetrics {
  const delta: [number, number, number] = [
    Math.abs(b.x - a.x),
    Math.abs(b.y - a.y),
    Math.abs(b.z - a.z),
  ];
  const size: [number, number, number] = [delta[0] + 1, delta[1] + 1, delta[2] + 1];
  const longer = size.filter((n) => n > 1).length;
  return {
    size,
    delta,
    dist: Math.hypot(delta[0], delta[1], delta[2]),
    straight: longer <= 1,
  };
}

/** Texts for a measurement label: main line + small secondary line. */
export function tapeLabel(m: TapeMetrics): { main: string; sub: string } {
  const [sx, sy, sz] = m.size;
  const main = m.straight
    ? t("schematics.tape.blocks", { count: Math.max(sx, sy, sz) })
    : t("schematics.tape.size", { x: sx, y: sy, z: sz });
  const delta = t("schematics.tape.delta", { x: m.delta[0], y: m.delta[1], z: m.delta[2] });
  const sub = m.straight ? delta : `${delta} · ${t("schematics.tape.dist", { d: m.dist.toFixed(1) })}`;
  return { main, sub };
}
