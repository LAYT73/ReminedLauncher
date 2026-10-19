import { useCallback, useEffect, useRef, useState } from "react";
import {
  listFriendships,
  type FriendRow,
} from "@/entities/friend";
import {
  listMyOpenRooms,
  listPendingInvites,
  subscribeInvites,
  type VoiceInvite,
  type VoiceRoom,
} from "@/entities/voice-room";
import { errorMessage, type ToastFn } from "./types";

/** Friends, my open rooms and pending invites (live-updated), plus the invite toast. */
export function useVoiceLists(
  userId: string,
  onToast: ToastFn,
  onInvitesChange?: (count: number) => void,
) {
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [invites, setInvites] = useState<VoiceInvite[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  /** Invite ids we've already announced — so we only toast on genuinely new ones. */
  const seenInvites = useRef<Set<string> | null>(null);
  const toastRef = useRef(onToast);
  toastRef.current = onToast;

  const refreshLists = useCallback(async () => {
    try {
      const [r, i, f] = await Promise.all([
        listMyOpenRooms(userId),
        listPendingInvites(userId),
        listFriendships(userId),
      ]);
      setRooms(r);
      setInvites(i);
      setFriends(f);
    } catch (err) {
      toastRef.current(errorMessage(err), "err");
    } finally {
      setListsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refreshLists();
    return subscribeInvites(userId, () => void refreshLists());
  }, [userId, refreshLists]);

  // Keep the Voice-tab badge in sync with the pending-invite count.
  useEffect(() => {
    onInvitesChange?.(invites.length);
  }, [invites.length, onInvitesChange]);

  // Toast when a genuinely new invite arrives (not on the initial load).
  useEffect(() => {
    const current = new Set(invites.map((i) => i.id));
    const seen = seenInvites.current;
    seenInvites.current = current;
    if (seen === null) return; // first load — don't announce what's already there
    const first = invites.find((i) => !seen.has(i.id));
    if (!first) return;
    toastRef.current(
      `${first.fromName || "A friend"} invited you to ${first.roomTitle || "a voice room"}`,
      "ok",
    );
  }, [invites]);

  return { friends, rooms, invites, listsLoading, refreshLists };
}
