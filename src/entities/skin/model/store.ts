import { create } from "zustand";
import { mediaSrc, warmMediaCache } from "@/shared/lib/mediaCache";
import { readOfflineCache, useSessionStore } from "@/entities/session";
import { skinApi } from "../api/skin-api";
import { isSkinUrl } from "../lib/skinUrl";

type SkinState = {
  /** URL / data-URL shown in avatars and the 3D preview. */
  preview: string | null;
  /** Cape texture for the 3D preview (profile / home). */
  capePreview: string | null;
  setPreview: (preview: string | null) => void;
  setCapePreview: (capePreview: string | null) => void;
  /** Resolve a profile `skin_path` (local file or CDN URL) into a preview. */
  applyPreview: (path: string | null | undefined) => Promise<void>;
  /** Resolve a profile `cape_path` into the cape preview. */
  applyCapePreview: (path: string | null | undefined) => Promise<void>;
};

/** Ignore stale async completions when the user swaps skins/capes quickly. */
let previewGen = 0;
let capeGen = 0;

export const useSkinStore = create<SkinState>((set) => ({
  preview: null,
  capePreview: null,
  setPreview: (preview) => {
    previewGen += 1;
    set({ preview });
  },
  setCapePreview: (capePreview) => {
    capeGen += 1;
    set({ capePreview });
  },
  applyPreview: async (path) => {
    const gen = ++previewGen;
    const setIfCurrent = (preview: string | null) => {
      if (gen !== previewGen) return;
      set({ preview });
    };

    if (!path) {
      setIfCurrent(null);
      return;
    }

    if (isSkinUrl(path)) {
      const offline = useSessionStore.getState().offlineMode;
      if (offline) {
        const local = mediaSrc(path);
        if (local?.startsWith("data:")) {
          setIfCurrent(local);
          return;
        }
        const cached = readOfflineCache().account?.skin_data_url;
        if (cached) {
          setIfCurrent(cached);
          return;
        }
      }

      const bust = path.includes("?") ? path : `${path}?t=${Date.now()}`;
      setIfCurrent(bust);
      void warmMediaCache([path]).then(() => {
        if (gen !== previewGen) return;
        const warmed = mediaSrc(path);
        if (warmed?.startsWith("data:")) set({ preview: warmed });
      });
      return;
    }

    try {
      const data = await skinApi.readDataUrl(path);
      setIfCurrent(data ?? readOfflineCache().account?.skin_data_url ?? null);
    } catch {
      setIfCurrent(readOfflineCache().account?.skin_data_url ?? null);
    }
  },
  applyCapePreview: async (path) => {
    const gen = ++capeGen;
    const setIfCurrent = (capePreview: string | null) => {
      if (gen !== capeGen) return;
      set({ capePreview });
    };

    if (!path) {
      setIfCurrent(null);
      return;
    }

    if (isSkinUrl(path)) {
      const offline = useSessionStore.getState().offlineMode;
      if (offline) {
        const local = mediaSrc(path);
        if (local?.startsWith("data:")) {
          setIfCurrent(local);
          return;
        }
        const cached = readOfflineCache().account?.cape_data_url;
        if (cached) {
          setIfCurrent(cached);
          return;
        }
      }

      const bust = path.includes("?") ? path : `${path}?t=${Date.now()}`;
      setIfCurrent(bust);
      void warmMediaCache([path]).then(() => {
        if (gen !== capeGen) return;
        const warmed = mediaSrc(path);
        if (warmed?.startsWith("data:")) set({ capePreview: warmed });
      });
      return;
    }

    try {
      const data = await skinApi.readDataUrl(path);
      setIfCurrent(data ?? readOfflineCache().account?.cape_data_url ?? null);
    } catch {
      setIfCurrent(readOfflineCache().account?.cape_data_url ?? null);
    }
  },
}));
