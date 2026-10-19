import { useCallback, useEffect, useRef, useState } from "react";
import {
  listRoomMembers,
  type VoiceMember,
  type VoiceRoom,
} from "@/entities/voice-room";
import { voiceGuestConnect } from "../api/voiceNative";
import { VoiceSession, type VoiceVideoTile } from "../lib/voiceSession";
import { errorMessage, type ToastFn } from "./types";
import { MSG } from "@/shared/config/messages";

type Args = {
  userId: string;
  displayName: string;
  onToast: ToastFn;
  onRoomStatusChange?: (inRoom: boolean) => void;
  setMembers: (members: VoiceMember[]) => void;
};

/** The LiveKit session and everything that mirrors it into UI state. */
export function useLiveSession({
  userId,
  displayName,
  onToast,
  onRoomStatusChange,
  setMembers,
}: Args) {
  const sessionRef = useRef<VoiceSession | null>(null);
  const [status, setStatus] = useState("");
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [videoTiles, setVideoTiles] = useState<VoiceVideoTile[]>([]);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [micId, setMicId] = useState("");
  const [outputId, setOutputId] = useState("");
  const [, setStateTick] = useState(0);

  // Leaving the panel (sign-out) must drop the session.
  useEffect(
    () => () => {
      void sessionRef.current?.disconnect();
      sessionRef.current = null;
    },
    [],
  );

  const disconnect = useCallback(async () => {
    await sessionRef.current?.disconnect().catch(() => undefined);
    sessionRef.current = null;
  }, []);

  const resetLiveUi = useCallback(() => {
    setSpeaking({});
    setStatus("");
    setMuted(false);
    setDeafened(false);
    setVideoTiles([]);
    setCamOn(false);
    setScreenOn(false);
    setVolumes({});
  }, []);

  /** Connect Porthole (guests) and LiveKit for `room`. */
  async function connect(room: VoiceRoom, asGuest: boolean) {
    setStatus(asGuest ? "Connecting Porthole…" : MSG.voice.connectingVoice);
    if (asGuest) {
      if (!room.portholeShareCode) throw new Error("Room has no share code yet — ask the host to wait for the lobby code");
      await voiceGuestConnect(room.portholeShareCode);
      setStatus(MSG.voice.connectingVoice);
    }
    const session = new VoiceSession({
      onParticipants: () => {
        setStateTick((t) => t + 1);
        void listRoomMembers(room.id).then(setMembers);
      },
      onVideo: () => {
        const sess = sessionRef.current;
        setVideoTiles(sess ? sess.videoTiles() : []);
        setCamOn(sess?.isCameraOn() ?? false);
        setScreenOn(sess?.isScreenSharing() ?? false);
      },
      onSpeaking: (id, on) => setSpeaking((prev) => ({ ...prev, [id]: on })),
      onDisconnected: () => {
        // Keep the room UI; host may still be exposing Porthole. User leaves explicitly.
        setStatus("Voice disconnected — try Leave, then Create again if needed");
        onRoomStatusChange?.(false);
      },
      onError: (m) => onToast(m, "err"),
    });
    // Prefer 127.0.0.1 — Porthole binds loopback; `localhost` can hit ::1 first.
    const wsUrl = (room.lkWsUrl || "ws://127.0.0.1:7880").replace(
      "ws://localhost:",
      "ws://127.0.0.1:",
    );
    const connectOpts = {
      wsUrl,
      roomId: room.id,
      identity: userId,
      name: displayName,
      micDeviceId: micId || undefined,
      outputDeviceId: outputId || undefined,
    };
    // Guests: tunnel may need a beat after the TCP probe before WKWebView WS works.
    let lastErr: unknown;
    const attempts = asGuest ? 4 : 1;
    for (let i = 0; i < attempts; i++) {
      try {
        if (i > 0) {
          setStatus(`Connecting voice… (retry ${i + 1}/${attempts})`);
          await new Promise((r) => setTimeout(r, 700 * i));
        }
        await session.connect(connectOpts);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!asGuest || i === attempts - 1) throw err;
        if (!/signal|unreachable|Load failed|timeout|refused|WebRTC/i.test(msg)) {
          throw err;
        }
      }
    }
    if (lastErr) throw lastErr;
    sessionRef.current = session;
    setMuted(false);
    setDeafened(false);
    setStatus("In voice");
  }

  async function toggleCamera() {
    try {
      await sessionRef.current?.setCameraEnabled(!camOn);
    } catch (err) {
      onToast(`Camera unavailable: ${errorMessage(err)}`, "err");
    }
  }

  async function toggleScreen() {
    try {
      await sessionRef.current?.setScreenShareEnabled(!screenOn);
    } catch (err) {
      onToast(`Screen share unavailable: ${errorMessage(err)}`, "err");
    }
  }

  return {
    sessionRef,
    status,
    setStatus,
    muted,
    setMuted,
    deafened,
    setDeafened,
    speaking,
    volumes,
    setVolumes,
    videoTiles,
    camOn,
    screenOn,
    micId,
    setMicId,
    outputId,
    setOutputId,
    connect,
    disconnect,
    resetLiveUi,
    toggleCamera,
    toggleScreen,
  };
}

export type LiveSession = ReturnType<typeof useLiveSession>;
