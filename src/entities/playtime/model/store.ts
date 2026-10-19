import { create } from "zustand";
import type { PlayStats } from "@/shared/lib/playtime";
import { useSessionStore } from "@/entities/session";
import {
  fetchMyPackPlaytimes,
  recordPackPlaySession,
} from "../api/playtime-api";
import {
  mergePlayStats,
  readLocalPackPlaytimes,
  writeLocalPackPlaytimes,
} from "../lib/localCache";

function userId(): string | null {
  return useSessionStore.getState().session?.user?.id ?? null;
}

function persist(byPack: Record<string, PlayStats>) {
  writeLocalPackPlaytimes(userId(), byPack);
}

type PlaytimeState = {
  byPack: Record<string, PlayStats>;
  loaded: boolean;
  setPackStats: (packId: string, stats: PlayStats) => void;
  replaceAll: (byPack: Record<string, PlayStats>) => void;
  clear: () => void;
  /** Merge cloud + local cache for the current user. */
  refresh: () => Promise<void>;
  /**
   * Optimistically update UI, persist locally, then sync to Supabase.
   * Always updates local even if the network call fails.
   */
  record: (packId: string, seconds: number) => Promise<void>;
};

export const usePlaytimeStore = create<PlaytimeState>((set, get) => ({
  byPack: {},
  loaded: false,
  setPackStats: (packId, stats) =>
    set((s) => {
      const byPack = { ...s.byPack, [packId]: stats };
      persist(byPack);
      return { byPack };
    }),
  replaceAll: (byPack) => {
    persist(byPack);
    set({ byPack, loaded: true });
  },
  clear: () => set({ byPack: {}, loaded: false }),
  refresh: async () => {
    const uid = userId();
    const local = readLocalPackPlaytimes(uid);
    const remote = await fetchMyPackPlaytimes();
    const merged: Record<string, PlayStats> = { ...local };
    for (const [id, st] of Object.entries(remote)) {
      const m = mergePlayStats(merged[id], st);
      if (m) merged[id] = m;
    }
    persist(merged);
    set({ byPack: merged, loaded: true });
  },
  record: async (packId, seconds) => {
    const id = packId.trim();
    if (!id) return;
    const add = Math.max(0, Math.floor(seconds));
    const prev = get().byPack[id];
    const optimistic: PlayStats = {
      playtimeSeconds: (prev?.playtimeSeconds ?? 0) + add,
      lastPlayedAt: new Date().toISOString(),
    };
    // Show immediately — even if Supabase is down / RPC broken.
    get().setPackStats(id, optimistic);

    const next = await recordPackPlaySession(id, add);
    if (!next) return;
    // Prefer server totals (authoritative) when available.
    get().setPackStats(next.packId, {
      playtimeSeconds: Math.max(
        optimistic.playtimeSeconds,
        next.playtimeSeconds,
      ),
      lastPlayedAt: next.lastPlayedAt ?? optimistic.lastPlayedAt,
    });
  },
}));

export function selectPackPlayStats(
  packId: string | null | undefined,
): (s: PlaytimeState) => PlayStats | null {
  return (s) => {
    const id = packId?.trim();
    if (!id) return null;
    return s.byPack[id] ?? null;
  };
}
