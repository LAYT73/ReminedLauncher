import type { Dispatch, SetStateAction } from "react";
import type { VoiceMember } from "@/entities/voice-room";
import type { VoiceSession, VoiceVideoTile } from "../lib/voiceSession";
import { McSelect } from "@/shared/ui/McSelect";
import { SkinHead } from "@/entities/skin";
import { StateBadge, VideoTileView } from "./VoiceBits";
import { FALLBACK_USERNAME } from "@/shared/config/limits";

type Props = {
  userId: string;
  session: VoiceSession | null;
  isHost: boolean;
  members: VoiceMember[];
  videoTiles: VoiceVideoTile[];
  speaking: Record<string, boolean>;
  volumes: Record<string, number>;
  setVolumes: Dispatch<SetStateAction<Record<string, number>>>;
  inviteOptions: { id: string; label: string; hint?: string }[];
  invitePick: string;
  setInvitePick: (id: string) => void;
  onInvite: () => Promise<void>;
};

/** Video tiles, member grid (with per-person volume) and the host's invite box. */
export function VoiceMembers({
  userId,
  session,
  isHost,
  members,
  videoTiles,
  speaking,
  volumes,
  setVolumes,
  inviteOptions,
  invitePick,
  setInvitePick,
  onInvite,
}: Props) {
  return (
    <div className="voice-col">
      {videoTiles.length > 0 ? (
        <div className="voice-video-row">
          {videoTiles.map((t) => (
            <VideoTileView
              key={`${t.identity}-${t.source}`}
              tile={t}
              label={
                members.find((m) => m.userId === t.identity)?.username ||
                FALLBACK_USERNAME
              }
            />
          ))}
        </div>
      ) : null}
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
            return (
              <div
                key={m.userId}
                className={`voice-tile ${
                  speaking[m.userId] ? "is-speaking" : ""
                }`}
              >
                <div className="voice-tile-avatar">
                  <SkinHead
                    skinUrl={m.skinPath ?? null}
                    className="voice-tile-skin"
                    size={64}
                  />
                  <div className="voice-tile-badges">
                    {st.muted ? <StateBadge kind="muted" /> : null}
                    {st.deafened ? <StateBadge kind="deafened" /> : null}
                  </div>
                </div>
                <strong className="voice-tile-name">
                  {m.username || FALLBACK_USERNAME}
                  {isMe ? " (you)" : ""}
                </strong>
                <span className="friend-id-static">
                  {m.role === "host" ? "Host" : "Member"}
                </span>
                {!isMe ? (
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
            disabled={inviteOptions.length === 0}
            placeholder={
              inviteOptions.length === 0
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
            disabled={!invitePick}
            onClick={() => void onInvite()}
          >
            Invite
          </button>
        </div>
      ) : null}
    </div>
  );
}
