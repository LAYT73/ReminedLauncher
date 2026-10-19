import { create } from "zustand";
import { mediaSrc, warmMediaCache } from "@/shared/lib/mediaCache";
import { readOfflineCache, useSessionStore } from "@/entities/session";
import { skinApi } from "../api/skin-api";
import { isSkinUrl } from "../lib/skinUrl";

type SkinState = {
  /** URL / data-URL shown in avatars and the 3D preview. */
  preview: string | null;
  setPreview: (preview: string | null) => void;
  /** Resolve a profile `skin_path` (local file or CDN URL) into a preview. */
  applyPreview: (path: string | null | undefined) => Promise<void>;
};

export const useSkinStore = create<SkinState>((set, get) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
  applyPreview: async (path) => {
    const { setPreview } = get();
    if (!path) {
      setPreview(null);
      return;
    }
    if (isSkinUrl(path)) {
      const local = mediaSrc(path);
      if (local && local.startsWith("data:")) {
        setPreview(local);
        return;
      }
      if (useSessionStore.getState().offlineMode) {
        const cached = readOfflineCache().account?.skin_data_url;
        if (cached) {
          setPreview(cached);
          return;
        }
      }
      // Online: show remote now, warm disk cache in background
      const bust = path.includes("?") ? path : `${path}?t=${Date.now()}`;
      setPreview(bust);
      void warmMediaCache([path]).then(() => {
        const warmed = mediaSrc(path);
        if (warmed?.startsWith("data:")) setPreview(warmed);
      });
      return;
    }
    try {
      setPreview(await skinApi.readDataUrl(path));
    } catch {
      setPreview(readOfflineCache().account?.skin_data_url ?? null);
    }
  },
}));
