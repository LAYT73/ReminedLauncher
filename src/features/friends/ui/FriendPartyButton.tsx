import { useState } from "react";
import type { FriendRow } from "@/entities/friend";
import { selectUserId, useSessionStore } from "@/entities/session";
import { inviteToParty, isPartyInvited, usePartyStore } from "@/entities/voice-room";
import { errorMessage } from "@/shared/lib/errors";
import { useT } from "@/shared/i18n";

/**
 * Party action for one friend: "Start party" when I am not in a party, "Invite
 * to party" when I host one. Shown for online friends only: an invite to someone
 * who is offline mostly goes stale before they open the launcher. Guests in
 * someone else's party see nothing (only the host invites).
 */
export function FriendPartyButton({
  row,
  onToast,
}: {
  row: FriendRow;
  onToast: (message: string) => void;
}) {
  const t = useT();
  const userId = useSessionStore(selectUserId);
  const room = usePartyStore((s) => s.room);
  const isHost = usePartyStore((s) => s.isHost);
  const members = usePartyStore((s) => s.members);
  // Re-renders on invite changes; expiry is checked by isPartyInvited.
  usePartyStore((s) => s.invited);
  const [busy, setBusy] = useState(false);

  const online = ["online", "in_game", "hosting"].includes(row.sessionStatus ?? "");
  if (row.direction !== "friend" || !online || !userId) return null;
  const friendId = row.profile.id;

  if (!room) {
    return (
      <button
        type="button"
        className="btn-mc ok friend-party"
        onClick={() => usePartyStore.getState().request({ kind: "start", friendId })}
      >
        {t("voice.party.startWith")}
      </button>
    );
  }
  if (!isHost) return null;

  if (members.some((m) => m.userId === friendId)) {
    return <span className="friend-party-tag">{t("voice.party.inParty")}</span>;
  }
  if (isPartyInvited(room.id, friendId)) {
    return <span className="friend-party-tag is-invited">{t("voice.party.invited")}</span>;
  }
  const full = members.length >= room.maxMembers;
  const starting = !room.relayShareCode;
  const title = full
    ? t("voice.party.full")
    : starting
      ? t("voice.party.startingHint")
      : t("voice.party.inviteFriend");
  return (
    <button
      type="button"
      className="btn-mc ok friend-party"
      disabled={busy || full || starting}
      title={title}
      onClick={() => {
        setBusy(true);
        void inviteToParty({ roomId: room.id, fromId: userId, toId: friendId })
          .catch((err) => onToast(errorMessage(err, "")))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? t("voice.party.inviting") : t("voice.party.inviteFriend")}
    </button>
  );
}
