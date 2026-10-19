import { create } from "zustand";
import type {
  CrashInfo,
  GameLiveStatus,
  GamePhase,
  HostingLan,
} from "./types";

type GameState = {
  phase: GamePhase;
  live: GameLiveStatus | null;
  crash: CrashInfo | null;
  /** Pack of the live game process (cleared when it exits) — for LAN / presence. */
  runningPackId: string | null;
  /** Last pack launched this session; survives exit so crash reports can be found. */
  lastLaunchedPackId: string | null;
  hostingLan: HostingLan | null;
  setPhase: (phase: GamePhase) => void;
  setLive: (live: GameLiveStatus | null) => void;
  setCrash: (crash: CrashInfo | null) => void;
  setRunningPackId: (packId: string | null) => void;
  setLastLaunchedPackId: (packId: string | null) => void;
  setHostingLan: (hosting: HostingLan | null) => void;
};

export const useGameStore = create<GameState>((set) => ({
  phase: "idle",
  live: null,
  crash: null,
  runningPackId: null,
  lastLaunchedPackId: null,
  hostingLan: null,
  setPhase: (phase) => set({ phase }),
  setLive: (live) => set({ live }),
  setCrash: (crash) => set({ crash }),
  setRunningPackId: (runningPackId) => set({ runningPackId }),
  setLastLaunchedPackId: (lastLaunchedPackId) => set({ lastLaunchedPackId }),
  setHostingLan: (hostingLan) => set({ hostingLan }),
}));
