import type { ElementJson, FaceJson, FaceName, ModelJson } from "../model/types";
import { hex, type RGB } from "./tints";

/**
 * Hand-written models (vanilla element format) for blocks whose vanilla model has
 * no elements because vanilla renders them with block-entity renderers. All models
 * are authored with the entity "front" toward south (+z) and are rotated by `y`
 * (any angle, degrees, same sense as blockstate `y`: 90 turns south -> west).
 */
export interface EntityOverride {
  model: ModelJson;
  /** y rotation in degrees (clockwise from above). */
  y: number;
  /** x rotation in degrees (blockstate sense: x=90 turns up -> north). */
  x?: number;
  /** Colour for faces carrying tintindex 0 in this model. */
  tint?: RGB;
}

interface Box {
  /** model-local texture variable */
  t: string;
  tw: number;
  th: number;
  /** texOffs */
  u: number;
  v: number;
  /** box size (texture net sizes) */
  w: number;
  h: number;
  d: number;
  /** block-space position, in 1/16 units (y up) */
  from: [number, number, number];
  /** visible geometry SIZE when different from w,h,d (e.g. squashed). Defaults to w,h,d. */
  to?: [number, number, number];
  tint?: boolean;
  /** drop the bottom `crop` pixel rows of the side nets (hidden overlap) */
  crop?: number;
  shade?: boolean;
}

/** Standard entity cuboid net (front = south). */
function box(b: Box): ElementJson {
  const { tw, th, u, v, w, h, d } = b;
  const U = (px: number) => (px * 16) / tw;
  const V = (px: number) => (px * 16) / th;
  const t = `#${b.t}`;
  const crop = b.crop ?? 0;
  const mk = (x0: number, y0: number, x1: number, y1: number, flipV = false): FaceJson => ({
    uv: flipV ? [U(x0), V(y1), U(x1), V(y0)] : [U(x0), V(y0), U(x1), V(y1)],
    texture: t,
    ...(b.tint ? { tintindex: 0 } : {}),
  });
  const sideTop = v + d;
  const sideBot = v + d + h - crop;
  const faces: Partial<Record<FaceName, FaceJson>> = {
    up: mk(u + d, v, u + d + w, v + d),
    down: mk(u + d + w, v, u + d + w + w, v + d, true),
    west: mk(u, sideTop, u + d, sideBot),
    south: mk(u + d, sideTop, u + d + w, sideBot),
    east: mk(u + d + w, sideTop, u + d + w + d, sideBot),
    north: mk(u + d + w + d, sideTop, u + d + w + d + w, sideBot),
  };
  const [x, y, z] = b.from;
  const to = b.to ?? [w, h, d];
  return {
    from: [x, y, z],
    to: [x + to[0], y + to[1], z + to[2]],
    shade: b.shade,
    faces,
  };
}

function inflate(el: ElementJson, g: number): ElementJson {
  return {
    ...el,
    from: [el.from[0] - g, el.from[1] - g, el.from[2] - g],
    to: [el.to[0] + g, el.to[1] + g, el.to[2] + g],
  };
}

function facingY(facing: string | undefined): number {
  switch (facing) {
    case "west":
      return 90;
    case "north":
      return 180;
    case "east":
      return 270;
    default:
      return 0;
  }
}

function model(textures: Record<string, string>, elements: ElementJson[]): ModelJson {
  return { textures, elements };
}

// ---------- chests ----------

const COPPER_STAGES: Record<string, string> = {
  copper_chest: "copper",
  exposed_copper_chest: "copper_exposed",
  weathered_copper_chest: "copper_weathered",
  oxidized_copper_chest: "copper_oxidized",
};

function chestTextureBase(name: string): string | null {
  const n = name.replace(/^waxed_/, "");
  if (n === "chest") return "normal";
  if (n === "trapped_chest") return "trapped";
  if (n === "ender_chest") return "ender";
  return COPPER_STAGES[n] ?? null;
}

/**
 * Cuboid of a y-up block-space entity model (26.x ChestModel): vanilla's ModelPart.Cube
 * unwrapping applied literally. Unlike `box` (y-down mob models, flipped when rendered)
 * the side nets are turned 180 degrees and the up face is v-flipped.
 */
function cubeUp(b: Box & { hide?: FaceName[] }): ElementJson {
  const { tw, th, u, v, w, h, d } = b;
  const t = `#${b.t}`;
  const R = (x0: number, y0: number, x1: number, y1: number): FaceJson => ({
    uv: [(x0 * 16) / tw, (y0 * 16) / th, (x1 * 16) / tw, (y1 * 16) / th],
    texture: t,
  });
  const top = v + d;
  const bot = v + d + h;
  const faces: Partial<Record<FaceName, FaceJson>> = {
    down: R(u + d, v, u + d + w, v + d),
    up: R(u + d + w, v + d, u + d + 2 * w, v),
    west: R(u + d, bot, u, top),
    north: R(u + d + w, bot, u + d, top),
    east: R(u + 2 * d + w, bot, u + d + w, top),
    south: R(u + 2 * d + 2 * w, bot, u + 2 * d + w, top),
  };
  for (const f of b.hide ?? []) delete faces[f];
  const [x, y, z] = b.from;
  return { from: [x, y, z], to: [x + w, y + h, z + d], faces };
}

/** Vanilla ChestModel layers (single / double left / double right), front = south. */
export function chestElements(type: "single" | "left" | "right"): ElementJson[] {
  const T = { tw: 64, th: 64, t: "c" };
  if (type === "single") {
    return [
      cubeUp({ ...T, u: 0, v: 19, w: 14, h: 10, d: 14, from: [1, 0, 1] }),
      cubeUp({ ...T, u: 0, v: 0, w: 14, h: 5, d: 14, from: [1, 9, 1] }),
      cubeUp({ ...T, u: 0, v: 0, w: 2, h: 4, d: 1, from: [7, 7, 15] }),
    ];
  }
  // the half whose seam is on the west (left) / east (right) end drops that face
  const left = type === "left";
  const hide: FaceName[] = [left ? "west" : "east"];
  const x0 = left ? 0 : 1;
  return [
    cubeUp({ ...T, u: 0, v: 19, w: 15, h: 10, d: 14, from: [x0, 0, 1], hide }),
    cubeUp({ ...T, u: 0, v: 0, w: 15, h: 5, d: 14, from: [x0, 9, 1], hide }),
    cubeUp({ ...T, u: 0, v: 0, w: 1, h: 4, d: 1, from: [left ? 0 : 15, 7, 15], hide }),
  ];
}

function chestOverride(name: string, props: Record<string, string>): EntityOverride | null {
  const base = chestTextureBase(name);
  if (!base) return null;
  const type = base === "ender" ? "single" : ((props.type ?? "single") as "single" | "left" | "right");
  const tex = type === "single" ? `entity/chest/${base}` : `entity/chest/${base}_${type}`;
  return { model: model({ c: tex }, chestElements(type)), y: facingY(props.facing) };
}

// ---------- shulker boxes ----------

function shulkerOverride(name: string, props: Record<string, string>): EntityOverride | null {
  if (!name.endsWith("shulker_box")) return null;
  const color = name === "shulker_box" ? "" : `_${name.slice(0, -"_shulker_box".length)}`;
  const T = { tw: 64, th: 64, t: "s" };
  const els = [
    box({ ...T, u: 0, v: 28, w: 16, h: 8, d: 16, from: [0, 0, 0] }),
    // lid is 12 tall in the net; only its upper 8 rows are visible above the base
    box({ ...T, u: 0, v: 0, w: 16, h: 12, d: 16, from: [0, 8, 0], to: [16, 8, 16], crop: 4 }),
  ];
  const facing = props.facing ?? "up";
  let x = 0;
  let y = 0;
  switch (facing) {
    case "down":
      x = 180;
      break;
    case "north":
      x = 90;
      break;
    case "east":
      x = 90;
      y = 90;
      break;
    case "south":
      x = 90;
      y = 180;
      break;
    case "west":
      x = 90;
      y = 270;
      break;
  }
  return { model: model({ s: `entity/shulker/shulker${color}` }, els), x, y };
}

// ---------- banners ----------

const DYE: Record<string, number> = {
  white: 0xf9fffe,
  orange: 0xf9801d,
  magenta: 0xc74ebd,
  light_blue: 0x3ab3da,
  yellow: 0xfed83d,
  lime: 0x80c71f,
  pink: 0xf38baa,
  gray: 0x474f52,
  light_gray: 0x9d9d97,
  cyan: 0x169c9c,
  purple: 0x8932b8,
  blue: 0x3c44aa,
  brown: 0x835432,
  green: 0x5e7c16,
  red: 0xb02e26,
  black: 0x1d1d21,
};

function bannerOverride(name: string, props: Record<string, string>): EntityOverride | null {
  const m = /^(.+?)_(wall_)?banner$/.exec(name);
  if (!m || !(m[1] in DYE)) return null;
  const wall = !!m[2];
  const tint = hex(DYE[m[1]]);
  const T = { tw: 64, th: 64, t: "b" };
  const k = 2 / 3;
  const fw = 20 * k;
  const left = 8 - fw / 2;
  let els: ElementJson[];
  if (wall) {
    // hangs from a bar against the north wall (front = south); flag squashed to fit the block
    els = [
      box({ ...T, u: 0, v: 42, w: 20, h: 2, d: 2, from: [left, 14.67, 0], to: [fw, 1.33, 1.33] }),
      box({
        ...T, u: 0, v: 0, w: 20, h: 40, d: 1,
        from: [left, 0, 1.33], to: [fw, 14.67, 0.67], tint: true,
      }),
    ];
  } else {
    els = [
      box({ ...T, u: 44, v: 0, w: 2, h: 42, d: 2, from: [8 - 0.67, 0, 8 - 0.67], to: [1.33, 28, 1.33] }),
      box({ ...T, u: 0, v: 42, w: 20, h: 2, d: 2, from: [left, 28, 8 - 0.67], to: [fw, 1.33, 1.33] }),
      box({
        ...T, u: 0, v: 0, w: 20, h: 40, d: 1,
        from: [left, 1.33, 8 + 0.67], to: [fw, 26.67, 0.67], tint: true,
      }),
    ];
  }
  const y = wall ? facingY(props.facing) : parseInt(props.rotation ?? "0", 10) * 22.5;
  return { model: model({ b: "entity/banner/banner_base" }, els), y, tint };
}

// ---------- heads ----------

interface SkullDef {
  tex: string;
  tw: number;
  th: number;
  hat: boolean;
  kind?: "piglin" | "dragon";
}

const SKULLS: Record<string, SkullDef> = {
  skeleton: { tex: "entity/skeleton/skeleton", tw: 64, th: 32, hat: false },
  wither_skeleton: { tex: "entity/skeleton/wither_skeleton", tw: 64, th: 32, hat: false },
  zombie: { tex: "entity/zombie/zombie", tw: 64, th: 64, hat: false },
  creeper: { tex: "entity/creeper/creeper", tw: 64, th: 32, hat: false },
  piglin: { tex: "entity/piglin/piglin", tw: 64, th: 64, hat: false, kind: "piglin" },
  dragon: { tex: "entity/enderdragon/dragon", tw: 256, th: 256, hat: false, kind: "dragon" },
  player: { tex: "entity/player/wide/steve", tw: 64, th: 64, hat: true },
};

function skullOverride(name: string, props: Record<string, string>): EntityOverride | null {
  const m = /^(skeleton|wither_skeleton|zombie|creeper|piglin|dragon|player)_(wall_)?(skull|head)$/.exec(name);
  if (!m) return null;
  const def = SKULLS[m[1]];
  const wall = !!m[2];
  const T = { tw: def.tw, th: def.th, t: "h" };
  // head centre: floor = x8,z8 / y 0..; wall = flush with the north wall, y 4..
  const cy = wall ? 4 : 0;
  const cz = wall ? 0 : 4;
  let els: ElementJson[];
  if (def.kind === "dragon") {
    // simplified dragon head (model is scaled 0.75 in vanilla)
    const s = 0.75;
    els = [
      box({
        ...T, u: 112, v: 30, w: 12, h: 5, d: 16,
        from: [8 - 6 * s, cy + 3, cz], to: [12 * s, 5 * s, 16 * s],
      }),
      box({
        ...T, u: 176, v: 65, w: 12, h: 4, d: 16,
        from: [8 - 6 * s, cy, cz], to: [12 * s, 4 * s, 16 * s],
      }),
    ];
  } else if (def.kind === "piglin") {
    els = [
      box({ ...T, u: 0, v: 0, w: 10, h: 8, d: 8, from: [3, cy, cz] }),
      box({ ...T, u: 31, v: 1, w: 4, h: 4, d: 1, from: [6, cy + 1, cz + 8] }),
      box({ ...T, u: 51, v: 6, w: 1, h: 5, d: 4, from: [13, cy + 3, cz + 2] }),
      box({ ...T, u: 39, v: 6, w: 1, h: 5, d: 4, from: [2, cy + 3, cz + 2] }),
    ];
  } else {
    els = [box({ ...T, u: 0, v: 0, w: 8, h: 8, d: 8, from: [4, cy, cz] })];
    if (def.hat) els.push(inflate(box({ ...T, u: 32, v: 0, w: 8, h: 8, d: 8, from: [4, cy, cz] }), 0.5));
  }
  const y = wall ? facingY(props.facing) : parseInt(props.rotation ?? "0", 10) * 22.5;
  return { model: model({ h: def.tex }, els), y };
}

// ---------- misc ----------

function potOverride(name: string): EntityOverride | null {
  if (name !== "decorated_pot") return null;
  const t = "entity/decorated_pot/decorated_pot_side";
  const side = (): FaceJson => ({ uv: [0, 0, 16, 16], texture: "#p" });
  const mk = (from: [number, number, number], to: [number, number, number]): ElementJson => ({
    from,
    to,
    faces: { up: side(), down: side(), north: side(), south: side(), east: side(), west: side() },
  });
  return {
    model: model({ p: t }, [mk([1, 0, 1], [15, 13, 15]), mk([4, 13, 4], [12, 16, 12])]),
    y: 0,
  };
}

function conduitOverride(name: string): EntityOverride | null {
  if (name !== "conduit") return null;
  return {
    model: model({ e: "entity/conduit/base", c: "entity/conduit/cage" }, [
      box({ tw: 32, th: 16, t: "e", u: 0, v: 0, w: 6, h: 6, d: 6, from: [5, 5, 5] }),
      box({ tw: 32, th: 16, t: "c", u: 0, v: 0, w: 8, h: 8, d: 8, from: [4, 4, 4] }),
    ]),
    y: 0,
  };
}

/** Bell body (vanilla bell models only contain the frame/bar). */
export function bellBodyModel(): ModelJson {
  const T = { tw: 32, th: 32, t: "b" };
  return model({ b: "entity/bell/bell_body" }, [
    box({ ...T, u: 0, v: 0, w: 6, h: 7, d: 6, from: [5, 6, 5] }),
    box({ ...T, u: 0, v: 13, w: 8, h: 2, d: 8, from: [4, 4, 4] }),
  ]);
}

function bellOverride(name: string): EntityOverride | null {
  return name === "bell" ? { model: bellBodyModel(), y: 0 } : null;
}

/** Entity-style model for a block, or null when the vanilla blockstate is used. */
export function entityModelFor(name: string, props: Record<string, string>): EntityOverride | null {
  return (
    chestOverride(name, props) ??
    shulkerOverride(name, props) ??
    bannerOverride(name, props) ??
    skullOverride(name, props) ??
    potOverride(name) ??
    conduitOverride(name) ??
    null
  );
}

/**
 * Extra geometry added ON TOP of the vanilla blockstate model (the bell body).
 * Kept separate from entityModelFor, which replaces the vanilla model.
 */
export function entityExtraModelFor(name: string): EntityOverride | null {
  return bellOverride(name);
}
