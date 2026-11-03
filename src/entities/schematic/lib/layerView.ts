import * as THREE from "three";
import type { LayerCaps, LayerGeometry, LayerStyle, SchematicMaterials } from "./mesher";

export type LayerState = LayerStyle | "hidden";

interface LayerMeshes {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  opaque?: THREE.Mesh;
  cutout?: THREE.Mesh;
  translucent?: THREE.Mesh;
  capsDown: THREE.Mesh[];
  capsUp: THREE.Mesh[];
  state: LayerState;
}

/**
 * Scene-graph helper: one THREE.Group per layer (userData.layerY = y) so a layer's
 * look can be switched between normal (current / built), dimmed, ghost or hidden.
 * Add `view.group` to your scene. Block (x,y,z) occupies [x,x+1]x[y,y+1]x[z,z+1].
 */
export class LayerView {
  readonly group = new THREE.Group();
  private layers: LayerMeshes[] = [];

  constructor(
    layers: LayerGeometry[],
    private materials: SchematicMaterials,
  ) {
    for (const l of layers) this.addLayer(l);
  }

  /** Append a layer (useful when consuming buildLayersIter incrementally). */
  addLayer(l: LayerGeometry, state: LayerState = "normal") {
    const g = new THREE.Group();
    g.userData.layerY = l.y;
    const lm: LayerMeshes = { group: g, meshes: [], capsDown: [], capsUp: [], state };
    const mk = (
      geo: THREE.BufferGeometry | null,
      kind: "opaque" | "cutout" | "translucent",
      cap?: LayerMeshes["capsUp"],
    ) => {
      if (!geo) return;
      const m = new THREE.Mesh(geo, this.materials.normal[kind]);
      m.userData.layerY = l.y;
      m.userData.kind = kind;
      m.renderOrder = kind === "translucent" ? 2 : 0;
      g.add(m);
      lm.meshes.push(m);
      if (cap) cap.push(m);
      else lm[kind] = m;
    };
    const mkCaps = (c: LayerCaps | null, cap: LayerMeshes["capsUp"]) => {
      if (!c) return;
      mk(c.opaque, "opaque", cap);
      mk(c.cutout, "cutout", cap);
      mk(c.translucent, "translucent", cap);
    };
    mk(l.opaque, "opaque");
    mk(l.cutout, "cutout");
    mk(l.translucent, "translucent");
    mkCaps(l.capsDown, lm.capsDown);
    mkCaps(l.capsUp, lm.capsUp);
    this.layers[l.y] = lm;
    this.group.add(g);
    this.apply(lm, state);
  }

  private apply(lm: LayerMeshes, state: LayerState) {
    lm.state = state;
    lm.group.visible = state !== "hidden";
    if (state !== "hidden") {
      const set = this.materials[state];
      for (const m of lm.meshes) {
        const kind = m.userData.kind as "opaque" | "cutout" | "translucent";
        m.material = set[kind];
        m.renderOrder = state === "ghost" ? 3 : kind === "translucent" ? 2 : 0;
      }
    }
    // Neighbours' caps depend on this layer's solidity, hidden included.
    for (let k = lm.group.userData.layerY - 1; k <= lm.group.userData.layerY + 1; k++) this.updateCaps(k);
  }

  /** A layer is "solid" when it fully covers the faces facing it (normal / dimmed). */
  private solid(y: number): boolean {
    const s = this.layers[y]?.state;
    return s === "normal" || s === "dimmed";
  }

  /** Cap faces (cross-layer culled) show only where the neighbour layer doesn't cover them. */
  private updateCaps(y: number) {
    const lm = this.layers[y];
    if (!lm) return;
    const up = !this.solid(y + 1);
    const down = !this.solid(y - 1);
    for (const m of lm.capsUp) m.visible = up;
    for (const m of lm.capsDown) m.visible = down;
  }

  setStyle(y: number, state: LayerState) {
    const lm = this.layers[y];
    if (lm && lm.state !== state) this.apply(lm, state);
  }

  setStyles(fn: (y: number) => LayerState) {
    this.layers.forEach((_, y) => this.setStyle(y, fn(y)));
  }

  getStyle(y: number): LayerState | undefined {
    return this.layers[y]?.state;
  }

  /** Meshes that should receive pointer rays (visible and not ghosted). */
  raycastTargets(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const lm of this.layers) {
      if (lm && lm.state !== "hidden" && lm.state !== "ghost") {
        for (const m of lm.meshes) if (m.visible) out.push(m);
      }
    }
    return out;
  }

  /** Frees geometries (materials are owned by SchematicMaterials). */
  dispose() {
    for (const lm of this.layers) lm?.meshes.forEach((m) => m.geometry.dispose());
    this.group.clear();
    this.layers = [];
  }
}
