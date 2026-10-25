import { create } from "zustand";
import type { StatusKind } from "./types";

type InstallState = {
  installing: boolean;
  /** Pack the current install is for (null when unknown, e.g. a sync without an id). */
  installPackId: string | null;
  /** "Sync pack" (settings) in flight. */
  packSyncing: boolean;
  percent: number;
  phase: string;
  message: string;
  /** Footer status text; ok/error variants auto-clear (see `useTransientStatus`). */
  status: string;
  statusKind: StatusKind;
  setPackSyncing: (syncing: boolean) => void;
  setStatus: (status: string, kind?: StatusKind) => void;
  /** Start an install: reset progress and clear the footer status. */
  begin: (message: string, packId?: string | null) => void;
  end: () => void;
  /** Reset progress for a launch (no install in flight). */
  beginLaunch: (message: string, packId?: string | null) => void;
  applyProgress: (e: { phase: string; percent: number; message: string }) => void;
};

export const useInstallStore = create<InstallState>((set) => ({
  installing: false,
  installPackId: null,
  packSyncing: false,
  percent: 0,
  phase: "",
  message: "",
  status: "",
  statusKind: "idle",
  setPackSyncing: (packSyncing) => set({ packSyncing }),
  setStatus: (status, statusKind = "idle") => set({ status, statusKind }),
  begin: (message, packId = null) =>
    set({
      installing: true,
      installPackId: packId,
      percent: 0,
      phase: "pack",
      message,
      status: "",
      statusKind: "idle",
    }),
  end: () => set({ installing: false, installPackId: null }),
  beginLaunch: (message, packId = null) =>
    set({ installPackId: packId, percent: 0, phase: "", message, statusKind: "idle" }),
  applyProgress: (e) =>
    set((s) => ({
      phase: e.phase,
      percent: Math.max(s.percent, e.percent),
      message: e.message,
    })),
}));

/** Shorthand for non-component code. */
export const setStatus = (text: string, kind: StatusKind = "idle") =>
  useInstallStore.getState().setStatus(text, kind);

export const setStatusError = (err: unknown) =>
  setStatus(err instanceof Error ? err.message : String(err), "error");
