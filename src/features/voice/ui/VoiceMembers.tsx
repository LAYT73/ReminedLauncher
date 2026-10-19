import type { Dispatch, SetStateAction } from "react";
import type { VoiceMember } from "@/entities/voice-room";
import type { VoiceSession } from "../lib/voiceSession";
import { McSelect } from "@/shared/ui/McSelect";
import { SkinHead } from "@/entities/skin";
import { StateBadge } from "./VoiceBits";
import { FALLBACK_USERNAME } from "@/shared/config/limits";

type Props = {
  userId: string;
  session: VoiceSession | null;
  isHost: boolean;
  /** Host has published a Porthole share code — invite only after this. */
  lobbyReady: boolean;
  members: VoiceMember[];
  speaking: Record<string, boolean>;
  volumes: Record<string, number>;
  setVolumes: Dispatch<SetStateAction<Record<string, number>>>;
  inviteOptions: { id: string; label: string; hint?: string }[];
  invitePick: string;
  setInvitePick: (id: string) => void;
  onInvite: () => Promise<void>;
};

/** Member grid (with per-person volume) and the host's invite box. */
export function VoiceMembers({
  userId,
  session,
  isHost,
  lobbyReady,
  members,
  speaking,
  volumes,
  setVolumes,
  inviteOptions,
  invitePick,
  setInvitePick,
  onInvite,
}: Props) {
  const liveIds = new Set(session?.participantIds() ?? []);
  return (
    <div className="voice-col">
      <h3 className="settings-heading">In room</h3>
      {members.length === 0 ? (
        <p className="friends-muted">Waiting for members…</p>
      ) : (
        <div className="voice-tile-grid">
          {members.map((m) => {
            const st = session?.getParticipantState(m.userId) ?? {
              muted: false,
              deafened: false,
            };
            const isMe = m.userId === userId;
            const inVoice = liveIds.has(m.userId);
            return (
              <div
                key={m.userId}
                className={`voice-tile ${
                  speaking[m.userId] && inVoice ? "is-speaking" : ""
                } ${inVoice ? "" : "is-connecting"}`}
              >
                <div className="voice-tile-avatar">
                  <SkinHead
                    skinUrl={m.skinPath ?? null}
                    className="voice-tile-skin"
                    size={64}
                  />
                  <div className="voice-tile-badges">
                    {inVoice && st.muted ? <StateBadge kind="muted" /> : null}
                    {inVoice && st.deafened ? (
                      <StateBadge kind="deafened" />
                    ) : null}
                  </div>
                </div>
                <strong className="voice-tile-name">
                  {m.username || FALLBACK_USERNAME}
                  {isMe ? " (you)" : ""}
                </strong>
                <span className="friend-id-static">
                  {!inVoice
                    ? "Connecting…"
                    : m.role === "host"
                      ? "Host · In voice"
                      : "In voice"}
                </span>
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
          })}
        </div>
      )}

      {isHost ? (
        <div className="voice-invite-block">
          <McSelect
            className="pack-select--full"
            label="Invite friend"
            menuPlacement="down"
            disabled={inviteOptions.length === 0 || !lobbyReady}
            placeholder={
              !lobbyReady
                ? "Lobby code loading…"
                : inviteOptions.length === 0
                  ? "No friends yet"
                  : "Choose a friend…"
            }
            options={inviteOptions}
            value={invitePick}
            onChange={setInvitePick}
          />
          <button
            type="button"
            className="btn-mc ok"
            disabled={!invitePick || !lobbyReady}
            onClick={() => void onInvite()}
          >
            Invite
          </button>
        </div>
      ) : null}
    </div>
  );
}
