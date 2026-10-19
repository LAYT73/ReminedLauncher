import { create } from "zustand";

/** Voice state that the shell (top nav, presence) needs outside the Voice tab. */
type VoiceStatusState = {
  inRoom: boolean;
  pendingInvites: number;
  setInRoom: (inRoom: boolean) => void;
  setPendingInvites: (count: number) => void;
};

export const useVoiceStatusStore = create<VoiceStatusState>((set) => ({
  inRoom: false,
  pendingInvites: 0,
  setInRoom: (inRoom) => set({ inRoom }),
  setPendingInvites: (pendingInvites) => set({ pendingInvites }),
}));
