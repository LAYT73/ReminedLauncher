import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import type { Gate } from "./types";

type SessionState = {
  gate: Gate;
  /** Boot splash is fading out. */
  bootLeaving: boolean;
  session: Session | null;
  /** Deliberate offline session (cached account), or connection lost. */
  offlineMode: boolean;
  authOfflineHint: string | null;
  /** Public "Remined id" of the signed-in (or cached) account. */
  reminedId: string | null;
  setGate: (gate: Gate) => void;
  setBootLeaving: (leaving: boolean) => void;
  setSession: (session: Session | null) => void;
  setOfflineMode: (offline: boolean) => void;
  setAuthOfflineHint: (hint: string | null) => void;
  setReminedId: (id: string | null) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  gate: "loading",
  bootLeaving: false,
  session: null,
  offlineMode: false,
  authOfflineHint: null,
  reminedId: null,
  setGate: (gate) => set({ gate }),
  setBootLeaving: (bootLeaving) => set({ bootLeaving }),
  setSession: (session) => set({ session }),
  setOfflineMode: (offlineMode) => set({ offlineMode }),
  setAuthOfflineHint: (authOfflineHint) => set({ authOfflineHint }),
  setReminedId: (reminedId) => set({ reminedId }),
}));

/** Signed-in user id (undefined while signed out / offline). */
export const selectUserId = (s: SessionState) => s.session?.user?.id;
