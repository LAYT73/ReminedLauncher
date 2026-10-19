import type { VoiceSession } from "../lib/voiceSession";
import { CamIcon, HearIcon, MicIcon, ScreenIcon } from "./VoiceBits";
import { MSG } from "@/shared/config/messages";

type Props = {
  session: VoiceSession | null;
  isHost: boolean;
  busy: boolean;
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
  onLeave: () => Promise<void>;
};

/** Mic / deafen / camera / share / devices + leave controls. */
export function VoiceToolbar({
  session,
  isHost,
  busy,
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
  onLeave,
}: Props) {
  return (
    <div className="voice-room-toolbar">
      <div className="voice-icon-group" role="group" aria-label="Voice controls">
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
          title={deafened ? "Undeafen" : "Deafen"}
          aria-label={deafened ? "Undeafen" : "Deafen"}
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
          title={camOn ? "Turn camera off" : "Turn camera on"}
          aria-label={camOn ? "Turn camera off" : "Turn camera on"}
          onClick={() => void toggleCamera()}
        >
          <CamIcon slashed={!camOn} />
        </button>
        <button
          type="button"
          className={`voice-icon-btn ${screenOn ? "is-on" : "is-neutral"}`}
          aria-pressed={screenOn}
          title={screenOn ? "Stop sharing screen" : "Share screen"}
          aria-label={screenOn ? "Stop sharing screen" : "Share screen"}
          onClick={() => void toggleScreen()}
        >
          <ScreenIcon slashed={!screenOn} />
        </button>
        <button
          type="button"
          className="voice-icon-btn is-neutral"
          title="Devices"
          aria-label="Voice devices"
          onClick={() => setDevicesOpen(true)}
        >
          <svg className="voice-icon-svg" viewBox="0 0 24 24" aria-hidden>
            <path
              fill="currentColor"
              d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-6a1 1 0 0 1 1 1v1.07a7.96 7.96 0 0 1 2.86 1.18l.76-.76a1 1 0 1 1 1.41 1.41l-.76.76A7.96 7.96 0 0 1 18.93 11H20a1 1 0 1 1 0 2h-1.07a7.96 7.96 0 0 1-1.18 2.86l.76.76a1 1 0 1 1-1.41 1.41l-.76-.76A7.96 7.96 0 0 1 13 18.93V20a1 1 0 1 1-2 0v-1.07a7.96 7.96 0 0 1-2.86-1.18l-.76.76a1 1 0 1 1-1.41-1.41l.76-.76A7.96 7.96 0 0 1 5.07 13H4a1 1 0 1 1 0-2h1.07a7.96 7.96 0 0 1 1.18-2.86l-.76-.76a1 1 0 1 1 1.41-1.41l.76.76A7.96 7.96 0 0 1 11 4.07V3a1 1 0 0 1 1-1z"
            />
          </svg>
        </button>
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
      </div>
      <div className="voice-room-actions">
        <button
          type="button"
          className="btn-mc danger"
          disabled={busy}
          onClick={() => void onLeave()}
        >
          {isHost ? "End room" : "Leave"}
        </button>
      </div>
    </div>
  );
}
