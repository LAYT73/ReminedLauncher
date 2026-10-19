import type {
  Dispatch,
  FormEvent,
  ReactNode,
  RefObject,
  SetStateAction,
} from "react";
import type {
  VoiceInvite,
  VoiceMember,
  VoiceMessage,
  VoiceRoom,
} from "@/entities/voice-room";
import type { VoiceSession, VoiceVideoTile } from "../lib/voiceSession";
import { SkinHead } from "@/entities/skin";
import { VoiceChat } from "./VoiceChat";
import { VoiceMembers } from "./VoiceMembers";
import { VoiceToolbar } from "./VoiceToolbar";
import { MSG } from "@/shared/config/messages";

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
  inviteOptions: { id: string; label: string; hint?: string }[];
  invitePick: string;
  setInvitePick: (id: string) => void;
  draft: string;
  setDraft: (v: string) => void;
  chatEndRef: RefObject<HTMLDivElement | null>;
  onToast: (msg: string, tone?: "default" | "ok" | "err") => void;
  setDevicesOpen: (open: boolean) => void;
  toggleCamera: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  onAcceptInvite: (inv: VoiceInvite) => Promise<void>;
  onDeclineInvite: (inv: VoiceInvite) => Promise<void>;
  onInvite: () => Promise<void>;
  onLeave: () => Promise<void>;
  onSend: (e: FormEvent) => Promise<void>;
  /** Modals rendered inside the panel section. */
  children?: ReactNode;
};

/** The "inside a room" screen: status, invites, controls, members and chat. */
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
    onToast,
    onAcceptInvite,
    onDeclineInvite,
    children,
  } = props;
  return (
    <section className="section voice-panel">
      <div className="page-title-row">
        <h2 className="page-title">{active.title}</h2>
        <div className="network-status-badges" aria-live="polite">
          <span className={`network-pill is-${tone}`}>
            <span className="network-pill-dot" aria-hidden />
            <span className="network-pill-label">Voice</span>
            <span className="network-pill-value">
              {status || "Idle"}
            </span>
          </span>
          <span
            className={`network-pill is-${isHost ? "ok" : "idle"}`}
          >
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

      {active.portholeShareCode ? (
        <p className="friends-lead voice-code-lead">
          Porthole code{" "}
          <button
            type="button"
            className="friend-id"
            onClick={() => {
              void navigator.clipboard.writeText(active.portholeShareCode!);
              onToast(MSG.voice.copiedShareCode);
            }}
          >
            {active.portholeShareCode}
          </button>
        </p>
      ) : null}

      <VoiceToolbar
        session={session}
        isHost={isHost}
        busy={busy}
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
        onLeave={props.onLeave}
      />

      <div className="voice-room-grid">
        <VoiceMembers
          userId={userId}
          session={session}
          isHost={isHost}
          lobbyReady={Boolean(active.portholeShareCode)}
          members={props.members}
          videoTiles={props.videoTiles}
          speaking={props.speaking}
          volumes={props.volumes}
          setVolumes={props.setVolumes}
          inviteOptions={props.inviteOptions}
          invitePick={props.invitePick}
          setInvitePick={props.setInvitePick}
          onInvite={props.onInvite}
        />
        <VoiceChat
          userId={userId}
          messages={props.messages}
          chatEndRef={props.chatEndRef}
          draft={props.draft}
          setDraft={props.setDraft}
          onSend={props.onSend}
        />
      </div>

      {children}
    </section>
  );
}
