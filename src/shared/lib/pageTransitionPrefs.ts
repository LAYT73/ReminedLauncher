import { create } from "zustand";

/** Local per-device UI preference for the page tile wipe (not synced). */
export type PageTransitionSpeed = "slow" | "normal" | "fast";

export type PageTransitionPrefs = {
  enabled: boolean;
  speed: PageTransitionSpeed;
};

export const PAGE_TRANSITION_SPEEDS: readonly PageTransitionSpeed[] = [
  "slow",
  "normal",
  "fast",
];

/** Multipliers applied to the normal cover/reveal/safety durations. */
export const PAGE_TRANSITION_SPEED_MULT: Record<PageTransitionSpeed, number> = {
  slow: 1.5,
  normal: 1,
  fast: 0.6,
};

const KEY = "remined.pageTransition";
const DEFAULTS: PageTransitionPrefs = { enabled: true, speed: "normal" };

function load(): PageTransitionPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<PageTransitionPrefs>;
    return {
      enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULTS.enabled,
      speed: PAGE_TRANSITION_SPEEDS.includes(v.speed as PageTransitionSpeed)
        ? (v.speed as PageTransitionSpeed)
        : DEFAULTS.speed,
    };
  } catch {
    return DEFAULTS;
  }
}

function save(p: PageTransitionPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

type Store = PageTransitionPrefs & {
  setEnabled: (enabled: boolean) => void;
  setSpeed: (speed: PageTransitionSpeed) => void;
};

export const usePageTransitionPrefs = create<Store>((set, get) => ({
  ...load(),
  setEnabled: (enabled) => {
    set({ enabled });
    save({ enabled, speed: get().speed });
  },
  setSpeed: (speed) => {
    set({ speed });
    save({ enabled: get().enabled, speed });
  },
}));
