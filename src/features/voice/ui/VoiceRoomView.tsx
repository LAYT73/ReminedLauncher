import { useState, type Dispatch, type FormEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import type {
  VoiceInvite,
  VoiceMember,
  VoiceMessage,
  VoiceRoom,
} from "@/entities/voice-room";
import type { VoiceSession, VoiceVideoTile } from "../lib/voiceSession";
import { SkinHead } from "@/entities/skin";
import type { McSelectOption } from "@/shared/ui/McSelect";
import { VoiceChat } from "./VoiceChat";
import { VoiceInviteModal } from "./VoiceInviteModal";
import { VoiceMembers } from "./VoiceMembers";
import { VoiceToolbar } from "./VoiceToolbar";
import { VoiceVideoStage } from "./VoiceVideoStage";

type Props = {
  userId: string;
  active: VoiceRoom;
  session: VoiceSession | null;
  isHost: boolean;
  busy: boolean;
  status: string;
  tone: string;
  invites: VoiceInvite[];
  members: VoiceMember[];
  messages: VoiceMessage[];
  videoTiles: VoiceVideoTile[];
  speaking: Record<string, boolean>;
  volumes: Record<string, number>;
  setVolumes: Dispatch<SetStateAction<Record<string, number>>>;
  muted: boolean;
  setMuted: (v: boolean) => void;
  deafened: boolean;
  setDeafened: (v: boolean) => void;
  camOn: boolean;
  screenOn: boolean;
  needsAudioUnlock: boolean;
  unlockAudio: () => void;
  inviteOptions: McSelectOption[];
  invitePick: string;
  setInvitePick: (id: string) => void;
  draft: string;
  setDraft: (v: string) => void;
  chatEndRef: RefObject<HTMLDivElement | null>;
  setDevicesOpen: (open: boolean) => void;
  toggleCamera: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  onAcceptInvite: (inv: VoiceInvite) => Promise<void>;
  onDeclineInvite: (inv: VoiceInvite) => Promise<void>;
  onInvite: () => Promise<void>;
  onLeave: () => Promise<void>;
  onSend: (e: FormEvent) => Promise<void>;
  children?: ReactNode;
};

/** In-room: video grid left; members + chat + controls stacked on the right. */
export function VoiceRoomView(props: Props) {
  const {
    userId,
    active,
    session,
    isHost,
    busy,
    status,
    tone,
    invites,
    onAcceptInvite,
    onDeclineInvite,
    children,
  } = props;
  const [inviteOpen, setInviteOpen] = useState(false);
  const lobbyReady = Boolean(active.portholeShareCode);

  return (
    <section className="section voice-panel is-room">
      <div className="page-title-row voice-room-head">
        <h2 className="page-title">{active.title}</h2>
        <div className="network-status-badges" aria-live="polite">
          <span className={`network-pill is-${tone}`}>
            <span className="network-pill-dot" aria-hidden />
            <span className="network-pill-label">Voice</span>
            <span className="network-pill-value">{status || "Idle"}</span>
          </span>
          <span className={`network-pill is-${isHost ? "ok" : "idle"}`}>
            <span className="network-pill-dot" aria-hidden />
            <span className="network-pill-label">Role</span>
            <span className="network-pill-value">
              {isHost ? "Host" : "Guest"}
            </span>
          </span>
        </div>
      </div>

      {invites.length > 0 ? (
        <div className="voice-invite-banner" role="status" aria-live="polite">
          {invites.map((inv) => (
            <div key={inv.id} className="voice-invite-banner-row">
              <SkinHead
                skinUrl={inv.fromSkinPath ?? null}
                className="voice-invite-banner-avatar"
                size={28}
              />
              <div className="voice-invite-banner-copy">
                <strong>{inv.fromName || "A friend"}</strong> invited you to{" "}
                <strong>{inv.roomTitle || "a voice room"}</strong>
              </div>
              <div className="voice-invite-banner-actions">
                <button
                  type="button"
                  className="btn-mc ok"
                  disabled={busy}
                  onClick={() => void onAcceptInvite(inv)}
                >
                  Join
                </button>
                <button
                  type="button"
                  className="btn-mc dim"
                  disabled={busy}
                  onClick={() => void onDeclineInvite(inv)}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="voice-room-layout">
        <div className="voice-room-main">
          <VoiceVideoStage tiles={props.videoTiles} members={props.members} />
        </div>

        <aside className="voice-sidebar">
          <div className="voice-sidebar-section voice-sidebar-members">
            <h3 className="settings-heading voice-sidebar-title">In room</h3>
            <VoiceMembers
              userId={userId}
              session={session}
              members={props.members}
              speaking={props.speaking}
              volumes={props.volumes}
              setVolumes={props.setVolumes}
            />
          </div>

          <div className="voice-sidebar-section voice-sidebar-chat">
            <h3 className="settings-heading voice-sidebar-title">Chat</h3>
            <VoiceChat
              userId={userId}
              messages={props.messages}
              chatEndRef={props.chatEndRef}
              draft={props.draft}
              setDraft={props.setDraft}
              onSend={props.onSend}
            />
          </div>

          <VoiceToolbar
            session={session}
            isHost={isHost}
            busy={busy}
            lobbyReady={lobbyReady}
            muted={props.muted}
            setMuted={props.setMuted}
            deafened={props.deafened}
            setDeafened={props.setDeafened}
            camOn={props.camOn}
            screenOn={props.screenOn}
            needsAudioUnlock={props.needsAudioUnlock}
            unlockAudio={props.unlockAudio}
            toggleCamera={props.toggleCamera}
            toggleScreen={props.toggleScreen}
            setDevicesOpen={props.setDevicesOpen}
            setInviteOpen={setInviteOpen}
            onLeave={props.onLeave}
          />
        </aside>
      </div>

      <VoiceInviteModal
        open={inviteOpen}
        busy={busy}
        lobbyReady={lobbyReady}
        inviteOptions={props.inviteOptions}
        invitePick={props.invitePick}
        setInvitePick={props.setInvitePick}
        onInvite={props.onInvite}
        onClose={() => setInviteOpen(false)}
      />

      {children}
    </section>
  );
}
