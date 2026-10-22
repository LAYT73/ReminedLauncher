import type { VoiceSession } from "../lib/voiceSession";
import {
  CamIcon,
  HearIcon,
  InviteIcon,
  LeaveIcon,
  MicIcon,
  ScreenIcon,
} from "./VoiceBits";
import { useT } from "@/shared/i18n";
import { MSG } from "@/shared/config/messages";
import { PixelGearIcon } from "@/shared/ui/PixelIcons";

type Props = {
  session: VoiceSession | null;
  isHost: boolean;
  busy: boolean;
  lobbyReady: boolean;
  muted: boolean;
  setMuted: (v: boolean) => void;
  deafened: boolean;
  setDeafened: (v: boolean) => void;
  camOn: boolean;
  screenOn: boolean;
  needsAudioUnlock: boolean;
  unlockAudio: () => void;
  toggleCamera: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  setDevicesOpen: (open: boolean) => void;
  setInviteOpen: (open: boolean) => void;
  onLeave: () => Promise<void>;
};

/** Mic / deafen / camera / share / invite / devices / leave — single row. */
export function VoiceToolbar({
  session,
  isHost,
  busy,
  lobbyReady,
  muted,
  setMuted,
  deafened,
  setDeafened,
  camOn,
  screenOn,
  needsAudioUnlock,
  unlockAudio,
  toggleCamera,
  toggleScreen,
  setDevicesOpen,
  setInviteOpen,
  onLeave,
}: Props) {
  const t = useT();
  return (
    <div
      className="voice-sidebar-controls"
      role="group"
      aria-label={t("voice.controls")}
    >
      <button
        type="button"
        className={`voice-icon-btn ${muted ? "is-off" : "is-on"}`}
        aria-pressed={!muted}
        title={muted ? MSG.voice.unmute : MSG.voice.mute}
        aria-label={muted ? MSG.voice.unmute : MSG.voice.mute}
        onClick={() => {
          const next = !muted;
          setMuted(next);
          void session?.setMuted(next);
        }}
      >
        <MicIcon slashed={muted} />
      </button>
      <button
        type="button"
        className={`voice-icon-btn ${deafened ? "is-off" : "is-on"}`}
        aria-pressed={!deafened}
        title={deafened ? t("voice.undeafen") : t("voice.deafen")}
        aria-label={deafened ? t("voice.undeafen") : t("voice.deafen")}
        onClick={() => {
          const next = !deafened;
          setDeafened(next);
          session?.setDeafened(next);
        }}
      >
        <HearIcon slashed={deafened} />
      </button>
      <button
        type="button"
        className={`voice-icon-btn ${camOn ? "is-on" : "is-neutral"}`}
        aria-pressed={camOn}
        title={camOn ? t("voice.cameraOff") : t("voice.cameraOn")}
        aria-label={camOn ? t("voice.cameraOff") : t("voice.cameraOn")}
        onClick={() => void toggleCamera()}
      >
        <CamIcon slashed={!camOn} />
      </button>
      <button
        type="button"
        className={`voice-icon-btn ${screenOn ? "is-on" : "is-neutral"}`}
        aria-pressed={screenOn}
        title={screenOn ? t("voice.stopSharing") : t("voice.shareScreen")}
        aria-label={screenOn ? t("voice.stopSharing") : t("voice.shareScreen")}
        onClick={() => void toggleScreen()}
      >
        <ScreenIcon slashed={!screenOn} />
      </button>
      <button
        type="button"
        className="voice-icon-btn is-neutral"
        title={t("voice.devices")}
        aria-label={t("voice.devicesAria")}
        onClick={() => setDevicesOpen(true)}
      >
        <PixelGearIcon className="voice-icon-svg" />
      </button>
      {isHost ? (
        <button
          type="button"
          className="voice-icon-btn is-neutral"
          title={lobbyReady ? t("voice.inviteFriend") : t("voice.lobbyOpening")}
          aria-label={t("voice.inviteFriend")}
          disabled={!lobbyReady || busy}
          onClick={() => setInviteOpen(true)}
        >
          <InviteIcon />
        </button>
      ) : null}
      {needsAudioUnlock ? (
        <button
          type="button"
          className="voice-icon-btn voice-text-btn voice-unlock-audio"
          title={MSG.voice.clickToHearHint}
          aria-label={MSG.voice.clickToHearHint}
          onClick={unlockAudio}
        >
          {MSG.voice.clickToHear}
        </button>
      ) : null}
      <button
        type="button"
        className="voice-icon-btn is-off"
        title={isHost ? t("voice.endRoom") : t("voice.leave")}
        aria-label={isHost ? t("voice.endRoom") : t("voice.leave")}
        disabled={busy}
        onClick={() => void onLeave()}
      >
        <LeaveIcon />
      </button>
    </div>
  );
}
