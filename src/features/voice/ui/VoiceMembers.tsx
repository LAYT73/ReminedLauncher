import type { Dispatch, SetStateAction } from "react";
import type { VoiceMember } from "@/entities/voice-room";
import type { VoiceSession } from "../lib/voiceSession";
import { SkinHead } from "@/entities/skin";
import { StateBadge } from "./VoiceBits";
import { FALLBACK_USERNAME } from "@/shared/config/limits";

type Props = {
  userId: string;
  session: VoiceSession | null;
  members: VoiceMember[];
  speaking: Record<string, boolean>;
  volumes: Record<string, number>;
  setVolumes: Dispatch<SetStateAction<Record<string, number>>>;
};

/** Right-sidebar member list (compact rows, not cards). */
export function VoiceMembers({
  userId,
  session,
  members,
  speaking,
  volumes,
  setVolumes,
}: Props) {
  const liveIds = new Set(session?.participantIds() ?? []);
  const iAmLive = liveIds.has(userId);

  return (
    <div className="voice-member-list">
      {members.length === 0 ? (
        <p className="friends-muted">Waiting for members…</p>
      ) : (
        members.map((m) => {
          const st = session?.getParticipantState(m.userId) ?? {
            muted: false,
            deafened: false,
          };
          const isMe = m.userId === userId;
          const inVoice = liveIds.has(m.userId);
          const pendingJoin = iAmLive && !inVoice && !isMe;
          const statusLabel = (() => {
            if (isMe && !inVoice) return "Connecting…";
            if (pendingJoin) return "Connecting…";
            if (!iAmLive) {
              return m.role === "host" ? "Host" : "In lobby";
            }
            if (m.role === "host") return "Host";
            return "In voice";
          })();
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
                  {m.username || FALLBACK_USERNAME}
                  {isMe ? " (you)" : ""}
                </strong>
                <span className="voice-member-status">{statusLabel}</span>
              </div>
              <div className="voice-member-badges">
                {inVoice && st.muted ? <StateBadge kind="muted" /> : null}
                {inVoice && st.deafened ? (
                  <StateBadge kind="deafened" />
                ) : null}
              </div>
              {!isMe && inVoice ? (
                <label className="voice-vol" title="Volume for this person">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round((volumes[m.userId] ?? 1) * 100)}
                    aria-label={`Volume for ${m.username || FALLBACK_USERNAME}`}
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
