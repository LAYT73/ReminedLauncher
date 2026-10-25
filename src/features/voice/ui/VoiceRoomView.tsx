import { Fragment, useState, type Dispatch, type FormEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import type {
  VoiceInvite,
  VoiceMember,
  VoiceMessage,
  VoiceRoom,
} from "@/entities/voice-room";
import type { VoiceLanJoin } from "../model/types";
import type { VoiceSession, VoiceVideoTile } from "../lib/voiceSession";
import { SkinHead } from "@/entities/skin";
import { useT } from "@/shared/i18n";
import { displayRoomTitle } from "../lib/roomName";
import { partyPackLabel } from "../lib/partyPack";
import { VoiceChat } from "./VoiceChat";
import { VoiceInviteModal, type InviteOption } from "./VoiceInviteModal";
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
  lanJoin?: VoiceLanJoin;
  videoTiles: VoiceVideoTile[];
  speaking: Record<string, boolean>;
  volumes: Record<string, number>;
  setVolumes: Dispatch<SetStateAction<Record<string, number>>>;
  muted: boolean;
  toggleMute: () => void;
  deafened: boolean;
  toggleDeafen: () => void;
  camOn: boolean;
  screenOn: boolean;
  needsAudioUnlock: boolean;
  unlockAudio: () => void;
  inviteOptions: InviteOption[];
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
  /** Party header card (pack, host, primary action). */
  partyCard?: ReactNode;
  children?: ReactNode;
};

/** In-room: video grid left; members + chat + controls stacked on the right. */
/** Splits a `{name}` template and swaps each placeholder for the given node. */
function fillTemplate(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((chunk, i) => {
    const key = /^\{(\w+)\}$/.exec(chunk)?.[1];
    return key && key in parts ? <Fragment key={i}>{parts[key]}</Fragment> : chunk;
  });
}

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
  const t = useT();
  const [inviteOpen, setInviteOpen] = useState(false);
  const lobbyReady = Boolean(active.relayShareCode);

  return (
    <section className="section voice-panel is-room">
      <div className="page-title-row voice-room-head">
        <h2 className="page-title">{displayRoomTitle(active.title)}</h2>
        <div className="network-status-badges" aria-live="polite">
          <span className={`network-pill is-${tone}`}>
            <span className="network-pill-dot" aria-hidden />
            <span className="network-pill-label">{t("voice.title")}</span>
            <span className="network-pill-value">{status || t("voice.idle")}</span>
          </span>
          <span className={`network-pill is-${isHost ? "ok" : "idle"}`}>
            <span className="network-pill-dot" aria-hidden />
            <span className="network-pill-label">{t("voice.role")}</span>
            <span className="network-pill-value">
              {isHost ? t("voice.host") : t("voice.guest")}
            </span>
          </span>
        </div>
      </div>

      {props.partyCard}

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
                {fillTemplate(t("voice.invitedYou"), {
                  name: <strong>{inv.fromName || t("voice.aFriend")}</strong>,
                })}
                {inv.roomPackId ? (
                  <span className="voice-invite-banner-pack">{partyPackLabel(inv.roomPackId)}</span>
                ) : null}
              </div>
              <div className="voice-invite-banner-actions">
                <button
                  type="button"
                  className="btn-mc ok"
                  disabled={busy}
                  onClick={() => void onAcceptInvite(inv)}
                >
                  {t("social.friends.accept")}
                </button>
                <button
                  type="button"
                  className="btn-mc dim"
                  disabled={busy}
                  onClick={() => void onDeclineInvite(inv)}
                >
                  {t("social.friends.decline")}
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
            <h3 className="settings-heading voice-sidebar-title">{t("voice.inRoom")}</h3>
            <VoiceMembers
              userId={userId}
              session={session}
              members={props.members}
              speaking={props.speaking}
              volumes={props.volumes}
              setVolumes={props.setVolumes}
              lanJoin={props.lanJoin}
              partyEnabled={Boolean(active.packId)}
            />
          </div>

          <div className="voice-sidebar-section voice-sidebar-chat">
            <h3 className="settings-heading voice-sidebar-title">{t("voice.chat")}</h3>
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
            isHost={isHost}
            busy={busy}
            lobbyReady={lobbyReady}
            muted={props.muted}
            toggleMute={props.toggleMute}
            deafened={props.deafened}
            toggleDeafen={props.toggleDeafen}
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
