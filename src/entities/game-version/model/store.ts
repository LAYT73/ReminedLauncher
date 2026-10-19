import { create } from "zustand";
import { readLastPlayed, writeLastPlayed } from "@/shared/lib/lastPlayed";
import type { Edition, VanillaVersionRow } from "./types";

type EditionState = {
  versions: VanillaVersionRow[];
  /** Picked Minecraft version id ("" = none). */
  pick: string;
  busy: boolean;
  loaded: boolean;
};

type VersionState = {
  by: Record<Edition, EditionState>;
  patch: (edition: Edition, patch: Partial<EditionState>) => void;
  /** Pick a version and remember it as last played. */
  select: (edition: Edition, versionId: string) => void;
  setInstalled: (edition: Edition, versionId: string, installed: boolean) => void;
};

const initial = (edition: Edition): EditionState => ({
  versions: [],
  pick: readLastPlayed()[edition] ?? "",
  busy: false,
  loaded: false,
});

export const useVersionStore = create<VersionState>((set) => ({
  by: { vanilla: initial("vanilla"), "remined-vanilla": initial("remined-vanilla") },
  patch: (edition, patch) =>
    set((s) => ({ by: { ...s.by, [edition]: { ...s.by[edition], ...patch } } })),
  select: (edition, versionId) => {
    writeLastPlayed({ [edition]: versionId });
    set((s) => ({
      by: { ...s.by, [edition]: { ...s.by[edition], pick: versionId } },
    }));
  },
  setInstalled: (edition, versionId, installed) =>
    set((s) => ({
      by: {
        ...s.by,
        [edition]: {
          ...s.by[edition],
          versions: s.by[edition].versions.map((v) =>
            v.id === versionId ? { ...v, installed } : v,
          ),
        },
      },
    })),
}));

export const useEditionState = (edition: Edition) =>
  useVersionStore((s) => s.by[edition]);

export const getEditionState = (edition: Edition) =>
  useVersionStore.getState().by[edition];
