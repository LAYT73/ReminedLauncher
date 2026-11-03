import { useEffect, useState } from "react";
import { getLocale } from "@/shared/i18n";
import {
  LayerView,
  buildLayers,
  computeMaterials,
  createAssets,
  createAtlasFor,
  createMaterials,
  decodeSchematic,
  loadAssets,
  schematicApi,
  type AssetsBundle,
  type Atlas,
  type DecodedSchematic,
  type MaterialList,
  type ResolvedAssets,
  type SchematicMaterials,
} from "@/entities/schematic";
import { localizedError } from "./format";

/** Vanilla assets version used for textures and block names. */
export const ASSETS_VERSION = "26.2";

export interface SchematicModel {
  decoded: DecodedSchematic;
  view: LayerView;
  materials: SchematicMaterials;
  atlas: Atlas;
  /** Resolved vanilla assets (models + textures), used for material icons. */
  assets: ResolvedAssets;
  list: MaterialList;
  /** Block id (no namespace) -> localized display name. */
  names: Record<string, string>;
  /** Non-air blocks per layer (index = y). */
  layerCounts: number[];
  dispose: () => void;
}

export type LoaderState =
  | { status: "idle" }
  | { status: "assets" }
  | { status: "building"; percent: number }
  | { status: "error"; message: string }
  | { status: "ready"; model: SchematicModel };

const resolvedCache = new WeakMap<AssetsBundle, Promise<ResolvedAssets>>();

function resolveAssets(bundle: AssetsBundle): Promise<ResolvedAssets> {
  let p = resolvedCache.get(bundle);
  if (!p) {
    p = createAssets(bundle);
    p.catch(() => resolvedCache.delete(bundle));
    resolvedCache.set(bundle, p);
  }
  return p;
}

const AIR_RE = /^(minecraft:)?(cave_|void_)?air(\[|$)/;

function countLayers(s: DecodedSchematic): number[] {
  const [sx, sy, sz] = s.size;
  const solid = s.palette.map((p) => !AIR_RE.test(p));
  const stride = sx * sz;
  const out: number[] = [];
  for (let y = 0; y < sy; y++) {
    let n = 0;
    const base = y * stride;
    for (let i = 0; i < stride; i++) if (solid[s.blocks[base + i]]) n++;
    out.push(n);
  }
  return out;
}

const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";

/**
 * Loads + builds the selected schematic. Geometry is built once per schematic
 * (and per retry); UI state never triggers a rebuild. The previous model is
 * disposed on switch/unmount and an in-flight build is aborted.
 */
export function useSchematicLoader(id: string | null, attempt: number): LoaderState {
  const [state, setState] = useState<LoaderState>({ status: "idle" });

  useEffect(() => {
    if (!id) {
      setState({ status: "idle" });
      return;
    }
    const ctrl = new AbortController();
    const { signal } = ctrl;
    let atlas: Atlas | null = null;
    let materials: SchematicMaterials | null = null;
    let view: LayerView | null = null;
    const dispose = () => {
      view?.dispose();
      materials?.dispose();
      atlas?.texture.dispose();
      view = null;
      materials = null;
      atlas = null;
    };

    setState({ status: "assets" });
    void (async () => {
      try {
        const [data, bundle] = await Promise.all([
          schematicApi.load(id),
          loadAssets(ASSETS_VERSION, getLocale()),
        ]);
        if (signal.aborted) return;
        const decoded = decodeSchematic(data);
        const assets = await resolveAssets(bundle);
        if (signal.aborted) return;
        atlas = await createAtlasFor(assets, decoded.palette);
        if (signal.aborted) return dispose();

        setState({ status: "building", percent: 0 });
        const layers = await buildLayers({
          schematic: decoded,
          assets,
          atlas,
          signal,
          onProgress: ({ done, total }) => {
            if (signal.aborted) return;
            setState({
              status: "building",
              percent: total > 0 ? Math.round((done / total) * 100) : 100,
            });
          },
        });
        if (signal.aborted) {
          layers.forEach((l) => {
            l.opaque?.dispose();
            l.cutout?.dispose();
            l.translucent?.dispose();
          });
          return dispose();
        }
        materials = createMaterials(atlas.texture);
        view = new LayerView(layers, materials);
        const model: SchematicModel = {
          decoded,
          view,
          materials,
          atlas,
          assets,
          list: computeMaterials(decoded, assets),
          names: bundle.names ?? {},
          layerCounts: countLayers(decoded),
          dispose,
        };
        setState({ status: "ready", model });
      } catch (err) {
        dispose();
        if (signal.aborted || isAbort(err)) return;
        setState({ status: "error", message: localizedError(err) });
      }
    })();

    return () => {
      ctrl.abort();
      dispose();
    };
  }, [id, attempt]);

  return state;
}
