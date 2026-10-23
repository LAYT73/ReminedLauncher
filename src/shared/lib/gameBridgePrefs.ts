import { create } from "zustand";
import { STORAGE_KEY } from "@/shared/config/storage-keys";

/** Local per-device in-game companion settings (not synced). */
export type GameBridgePrefs = {
  notifications: boolean;
  voiceHud: boolean;
};

const KEY = STORAGE_KEY.gameBridge;
const DEFAULTS: GameBridgePrefs = {
  notifications: true,
  voiceHud: true,
};

function load(): GameBridgePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    // Older builds stored `speaking` (now `voiceHud`) plus key bindings, which the mod owns now.
    const v = JSON.parse(raw) as Partial<Record<keyof GameBridgePrefs | "speaking", unknown>>;
    const hud = typeof v.voiceHud === "boolean" ? v.voiceHud : v.speaking;
    return {
      notifications:
        typeof v.notifications === "boolean" ? v.notifications : DEFAULTS.notifications,
      voiceHud: typeof hud === "boolean" ? hud : DEFAULTS.voiceHud,
    };
  } catch {
    return DEFAULTS;
  }
}

function save(p: GameBridgePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

type Store = GameBridgePrefs & {
  setNotifications: (notifications: boolean) => void;
  setVoiceHud: (voiceHud: boolean) => void;
};

export const useGameBridgePrefs = create<Store>((set, get) => {
  const current = (): GameBridgePrefs => {
    const s = get();
    return { notifications: s.notifications, voiceHud: s.voiceHud };
  };
  return {
    ...load(),
    setNotifications: (notifications) => {
      set({ notifications });
      save({ ...current(), notifications });
    },
    setVoiceHud: (voiceHud) => {
      set({ voiceHud });
      save({ ...current(), voiceHud });
    },
  };
});
