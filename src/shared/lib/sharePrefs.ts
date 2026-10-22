import { create } from "zustand";

/** Local per-device privacy pref: share in-game activity (dimension, pause...) with friends. */
const KEY = "remined.shareActivity";

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

type SharePrefs = {
  shareActivity: boolean;
  setShareActivity: (v: boolean) => void;
};

export const useSharePrefs = create<SharePrefs>((set) => ({
  shareActivity: load(),
  setShareActivity: (v) => {
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    set({ shareActivity: v });
  },
}));
