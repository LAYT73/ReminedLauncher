import { create } from "zustand";
import { TIMING } from "@/shared/config/timings";
import type { VoiceMember, VoiceRoom } from "./types";

/**
 * Work the party UI (friends list, deep links, in-game keys) asks the voice
 * feature to do. The voice feature owns the live session, so it picks these up.
 * `confirm` asks the player first (deep links); in-game keys are already a choice.
 */
export type PartyCommand =
  | { kind: "start"; friendId: string }
  | { kind: "join"; roomId: string; confirm?: boolean };

type PartyStoreState = {
  /** The voice room this client is in (null in lobby). Published by the voice feature. */
  room: VoiceRoom | null;
  isHost: boolean;
  members: VoiceMember[];
  /** "roomId:friendId" → time of the invite (ms). Drives the "Invited" chip. */
  invited: Record<string, number>;
  command: PartyCommand | null;
  setSnapshot: (snap: { room: VoiceRoom | null; isHost: boolean; members: VoiceMember[] }) => void;
  markInvited: (roomId: string, friendId: string) => void;
  /** Drop invites whose friend is now a member, or that are older than the invite TTL. */
  pruneInvited: () => void;
  request: (command: PartyCommand) => void;
  takeCommand: () => void;
  reset: () => void;
};

const EMPTY = {
  room: null,
  isHost: false,
  members: [],
  invited: {},
  command: null,
} satisfies Partial<PartyStoreState>;

function inviteKey(roomId: string, friendId: string): string {
  return `${roomId}:${friendId}`;
}

export const usePartyStore = create<PartyStoreState>((set) => ({
  ...EMPTY,
  setSnapshot: ({ room, isHost, members }) =>
    set((s) => {
      // Invites belong to one room: a different room starts with none.
      const sameRoom = (s.room?.id ?? null) === (room?.id ?? null);
      return {
        room,
        isHost,
        members,
        invited: sameRoom ? s.invited : {},
      };
    }),
  markInvited: (roomId, friendId) =>
    set((s) => ({ invited: { ...s.invited, [inviteKey(roomId, friendId)]: Date.now() } })),
  pruneInvited: () =>
    set((s) => {
      const now = Date.now();
      const roomId = s.room?.id;
      const memberIds = new Set(s.members.map((m) => m.userId));
      let changed = false;
      const next: Record<string, number> = {};
      for (const [key, at] of Object.entries(s.invited)) {
        const [keyRoom, friendId] = key.split(":");
        const stale = now - at > TIMING.partyInviteTtl;
        const joined = keyRoom === roomId && memberIds.has(friendId ?? "");
        if (stale || joined || keyRoom !== roomId) {
          changed = true;
          continue;
        }
        next[key] = at;
      }
      return changed ? { invited: next } : s;
    }),
  request: (command) => set({ command }),
  takeCommand: () => set({ command: null }),
  reset: () => set({ ...EMPTY }),
}));

/** True while an invite of this friend to this room is still shown as pending. */
export function isPartyInvited(roomId: string, friendId: string): boolean {
  const at = usePartyStore.getState().invited[inviteKey(roomId, friendId)];
  return at !== undefined && Date.now() - at <= TIMING.partyInviteTtl;
}
