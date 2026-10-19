import { create } from "zustand";
import type { CatalogPack } from "../api/catalog";
import type { Pack } from "./types";

type PackState = {
  /** Catalog ∪ local installs. */
  packs: Pack[];
  /** Marketing content from Supabase (or the offline cache). */
  catalog: CatalogPack[];
  installedIds: Set<string>;
  /** Bumped after media is (re)hydrated so localized URLs recompute. */
  mediaTick: number;
  setPacks: (packs: Pack[]) => void;
  setCatalog: (catalog: CatalogPack[]) => void;
  setInstalledIds: (ids: Set<string>) => void;
  markInstalled: (id: string) => void;
  markRemoved: (id: string) => void;
  bumpMedia: () => void;
};

export const usePackStore = create<PackState>((set) => ({
  packs: [],
  catalog: [],
  installedIds: new Set(),
  mediaTick: 0,
  setPacks: (packs) => set({ packs }),
  setCatalog: (catalog) => set({ catalog }),
  setInstalledIds: (installedIds) => set({ installedIds }),
  markInstalled: (id) =>
    set((s) => ({ installedIds: new Set(s.installedIds).add(id) })),
  markRemoved: (id) =>
    set((s) => {
      const next = new Set(s.installedIds);
      next.delete(id);
      return { installedIds: next };
    }),
  bumpMedia: () => set((s) => ({ mediaTick: s.mediaTick + 1 })),
}));
