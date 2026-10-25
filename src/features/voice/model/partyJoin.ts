import { create } from "zustand";

/** Host side: what the automatic Open-to-LAN for the party is doing right now. */
export type PartyAutoOpen =
  | { roomId: string; status: "opening" }
  | { roomId: string; status: "opened" }
  | { roomId: string; status: "failed"; reason: string }
  | { roomId: string; status: "unsupported" };

/**
 * Party room whose world this client joined through the party button. Lets the
 * member state tell "in the host's world" from "in some other multiplayer server".
 * Cleared by the publisher once the game is idle again.
 */
export const usePartyJoinStore = create<{
  joinedRoomId: string | null;
  setJoinedRoomId: (roomId: string | null) => void;
  autoOpen: PartyAutoOpen | null;
  setAutoOpen: (autoOpen: PartyAutoOpen | null) => void;
}>((set) => ({
  joinedRoomId: null,
  setJoinedRoomId: (joinedRoomId) => set({ joinedRoomId }),
  autoOpen: null,
  setAutoOpen: (autoOpen) => set({ autoOpen }),
}));
