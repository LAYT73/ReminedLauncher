import { useEffect } from "react";
import { create } from "zustand";
import { gameBridgeInfo, onGameBridgeStatus, type GameBridgeInfo } from "@/shared/api/gameBridge";

/** Whether the in-game companion mod is connected, and what it advertised (set by the Rust bridge). */
type GameBridgeState = {
  connected: boolean;
  /** Protocol version the mod reported (0 when disconnected or unknown). */
  v: number;
  /** Message types the mod handles; feature-detect with `hasBridgeCap`. */
  caps: string[];
  setInfo: (info: GameBridgeInfo) => void;
};

export const useGameBridgeStore = create<GameBridgeState>((set) => ({
  connected: false,
  v: 0,
  caps: [],
  setInfo: ({ connected, v, caps }) => set({ connected, v, caps }),
}));

/** True when the mod is connected and advertises `cap` (e.g. "open_lan"). */
export function hasBridgeCap(cap: string): boolean {
  const s = useGameBridgeStore.getState();
  return s.connected && s.caps.includes(cap);
}

/** Sync the bridge info from the initial status call and later status events. App-wide, mount once. */
export function useGameBridgeSync(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let eventSeen = false;
    const set = (info: GameBridgeInfo) => useGameBridgeStore.getState().setInfo(info);
    void gameBridgeInfo()
      .then((info) => {
        if (!cancelled && !eventSeen) set(info);
      })
      .catch(() => undefined);
    void onGameBridgeStatus((info) => {
      eventSeen = true;
      set(info);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
