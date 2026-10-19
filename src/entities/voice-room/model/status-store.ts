import { create } from "zustand";

/** Voice state that the shell (top nav, presence) needs outside the Voice tab. */
type VoiceStatusState = {
  inRoom: boolean;
  /** Set when the local user is hosting an open voice room (for Porthole merge). */
  hostRoomId: string | null;
  pendingInvites: number;
  setInRoom: (inRoom: boolean) => void;
  setHostRoomId: (roomId: string | null) => void;
  setPendingInvites: (count: number) => void;
};

export const useVoiceStatusStore = create<VoiceStatusState>((set) => ({
  inRoom: false,
  hostRoomId: null,
  pendingInvites: 0,
  // Do not clear hostRoomId here — a transient LiveKit drop must not make LAN
  // tear down the merged voice lobby. Leave/End clears hostRoomId explicitly.
  setInRoom: (inRoom) => set({ inRoom }),
  setHostRoomId: (hostRoomId) => set({ hostRoomId }),
  setPendingInvites: (pendingInvites) => set({ pendingInvites }),
}));
