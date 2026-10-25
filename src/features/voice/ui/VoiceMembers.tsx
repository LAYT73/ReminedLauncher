import type { FriendRow } from "@/entities/friend";
import type { Dispatch, SetStateAction } from "react";
import type { VoiceMember } from "@/entities/voice-room";
import type { VoiceLanJoin } from "../model/types";
import type { VoiceSession } from "../lib/voiceSession";
import { useMemo } from "react";
import { canJoinFriend, PresenceBadge, useFriendBadgeStore } from "@/entities/friend";
import { SkinHead } from "@/entities/skin";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { PixelPlayIcon } from "@/shared/ui/PixelIcons";
import { StateBadge } from "./VoiceBits";
import { useT } from "@/shared/i18n";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { effectiveMemberState } from "../lib/partyState";

type Props = {
  userId: string;
  session: VoiceSession | null;
  members: VoiceMember[];
  speaking: Record<string, boolean>;
  volumes: Record<string, number>;
  setVolumes: Dispatch<SetStateAction<Record<string, number>>>;
  lanJoin?: VoiceLanJoin;
  /** Room has a party pack: show each member's party state chip. */
  partyEnabled?: boolean;
};

/** Right-sidebar member list (compact rows, not cards). */
export function VoiceMembers({
  userId,
  session,
  members,
  speaking,
  volumes,
  setVolumes,
  lanJoin,
  partyEnabled = false,
}: Props) {
  const t = useT();
  const friendRows = useFriendBadgeStore((s) => s.rows);
  // Member <-> friend match: voice member userId === friend profile id.
  const friendByUserId = useMemo(() => {
    const map = new Map<string, FriendRow>();
    for (const r of friendRows ?? []) {
      if (r.direction === "friend") map.set(r.profile.id, r);
    }
    return map;
  }, [friendRows]);
  const partyLabel = (state: VoiceMember["state"], progress: number | null) => {
    switch (state) {
      case "installing":
        return progress == null
          ? t("voice.party.memberInstallingNoPct")
          : t("voice.party.memberInstalling", { p: progress });
      case "ready":
        return t("voice.party.memberReady");
      case "in_game":
        return t("voice.party.memberInGame");
      case "in_world":
        return t("voice.party.memberInWorld");
      default:
        return t("voice.party.memberJoined");
    }
  };
  const liveIds = new Set(session?.participantIds() ?? []);
  const iAmLive = liveIds.has(userId);

  return (
    <div className="voice-member-list">
      {members.length === 0 ? (
        <p className="friends-muted">{t("voice.members.waiting")}</p>
      ) : (
        members.map((m) => {
          const st = session?.getParticipantState(m.userId) ?? {
            muted: false,
            deafened: false,
          };
          const isMe = m.userId === userId;
          const inVoice = liveIds.has(m.userId);
          const pendingJoin = iAmLive && !inVoice && !isMe;
          const connecting = pendingJoin || (isMe && !inVoice);
          const roleLabel = m.role === "host" ? t("voice.host") : t("voice.guest");
          const friend = isMe ? undefined : friendByUserId.get(m.userId);
          const friendStatus = friend?.sessionStatus;
          const showPresence =
            friend && (friendStatus === "in_game" || friendStatus === "hosting");
          const name = m.username || FALLBACK_USERNAME;
          const joinable = Boolean(
            lanJoin && friend && canJoinFriend(friend),
          );
          const joining =
            joinable && lanJoin!.joiningFriendId === friend!.friendshipId;
          const showJoin = joinable && (joining || !lanJoin!.blocked);
          return (
            <div
              key={m.userId}
              className={`voice-member-row ${
                speaking[m.userId] && inVoice ? "is-speaking" : ""
              } ${pendingJoin || (isMe && !inVoice) ? "is-connecting" : ""}`}
            >
              <SkinHead
                skinUrl={m.skinPath ?? null}
                className="voice-member-avatar"
                size={28}
              />
              <div className="voice-member-meta">
                <strong className="voice-member-name">
                  {name}
                  {isMe ? t("voice.members.you") : ""}
                </strong>
                <div className="voice-member-tags">
                  <StatusBadge
                    tone={m.role === "host" ? "host" : "guest"}
                    title={roleLabel}
                  >
                    <span className="friend-status-kind">{roleLabel}</span>
                  </StatusBadge>
                  {connecting ? (
                    <StatusBadge
                      tone="connecting"
                      title={t("voice.members.connecting")}
                    >
                      <span className="voice-badge-dot" aria-hidden />
                      <span className="friend-status-kind">
                        {t("voice.members.connecting")}
                      </span>
                    </StatusBadge>
                  ) : null}
                  {inVoice && speaking[m.userId] ? (
                    <StatusBadge
                      tone="speaking"
                      title={t("voice.members.speaking")}
                    >
                      <span className="friend-status-kind">
                        {t("voice.members.speaking")}
                      </span>
                    </StatusBadge>
                  ) : null}
                  {partyEnabled ? (
                    <StatusBadge
                      tone="party"
                      title={partyLabel(effectiveMemberState(m), m.progress)}
                    >
                      <span className="friend-status-kind">
                        {partyLabel(effectiveMemberState(m), m.progress)}
                      </span>
                    </StatusBadge>
                  ) : null}
                  {showPresence ? <PresenceBadge row={friend!} /> : null}
                </div>
              </div>
              <div className="voice-member-badges">
                {inVoice && st.muted ? <StateBadge kind="muted" /> : null}
                {inVoice && st.deafened ? (
                  <StateBadge kind="deafened" />
                ) : null}
              </div>
              {showJoin ? (
                <button
                  type="button"
                  className="btn-mc ok voice-member-join"
                  disabled={Boolean(lanJoin!.joiningFriendId)}
                  aria-label={t("voice.members.joinAria", { name })}
                  title={t("voice.members.joinAria", { name })}
                  onClick={() => lanJoin!.onJoin(friend!)}
                >
                  <PixelPlayIcon className="voice-icon-svg" aria-hidden />
                  {joining ? t("voice.members.joining") : t("voice.members.join")}
                </button>
              ) : null}
              {!isMe && inVoice ? (
                <label className="voice-vol" title={t("voice.members.volumeTitle")}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round((volumes[m.userId] ?? 1) * 100)}
                    aria-label={t("voice.members.volumeFor", {
                      name,
                    })}
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      setVolumes((prev) => ({ ...prev, [m.userId]: v }));
                      session?.setParticipantVolume(m.userId, v);
                    }}
                  />
                </label>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
