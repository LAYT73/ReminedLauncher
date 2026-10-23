import { useEffect } from "react";
import { create } from "zustand";
import { gameBridgeStatus, onGameBridgeStatus } from "@/shared/api/gameBridge";

/** Whether the in-game companion mod is connected (set by the Rust bridge). */
type GameBridgeState = {
  connected: boolean;
  setConnected: (connected: boolean) => void;
};

export const useGameBridgeStore = create<GameBridgeState>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}));

/** Sync `connected` from the initial status call and later status events. App-wide, mount once. */
export function useGameBridgeSync(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let eventSeen = false;
    const set = (connected: boolean) => useGameBridgeStore.getState().setConnected(connected);
    void gameBridgeStatus()
      .then((c) => {
        if (!cancelled && !eventSeen) set(c);
      })
      .catch(() => undefined);
    void onGameBridgeStatus((c) => {
      eventSeen = true;
      set(c);
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
