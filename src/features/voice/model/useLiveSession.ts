import { useCallback, useEffect, useRef, useState } from "react";
import {
  getVoiceRoom,
  leaveVoiceRoom,
  listRoomMembers,
  type VoiceMember,
  type VoiceRoom,
} from "@/entities/voice-room";
import { netLog } from "@/shared/api/netLog";
import { voiceGuestConnect, voiceGuestDisconnect } from "../api/voiceNative";
import { VoiceSession, type VoiceVideoTile } from "../lib/voiceSession";
import { errorMessage, type ToastFn } from "./types";
import { MSG } from "@/shared/config/messages";

const REMOTE_LEAVE_GRACE_MS = 4000;
const RECONNECT_GRACE_MS = 2000;
const RECONNECT_TRIES = 6;

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
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const audioUnlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pruneTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [, setStateTick] = useState(0);
  /** Share code we last successfully joined as a guest (LiveKit up). */
  const joinedCodeRef = useRef<string | null>(null);
  /** Share code the current guest connect() attempt is targeting. */
  const connectingCodeRef = useRef<string | null>(null);
  /** Newer lobby:<id> that arrived while connect/reconnect was in flight. */
  const pendingShareCodeRef = useRef<string | null>(null);
  const guestRoomRef = useRef<VoiceRoom | null>(null);
  const intentionalLeaveRef = useRef(false);
  const reconnectingRef = useRef(false);
  /** True while connect()/voiceGuestConnect is in flight. */
  const connectingRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectFnRef = useRef<(opts?: { force?: boolean }) => Promise<void>>(
    async () => undefined,
  );

  const clearPruneTimers = useCallback(() => {
    for (const t of pruneTimers.current.values()) clearTimeout(t);
    pruneTimers.current.clear();
  }, []);

  const refreshVideo = useCallback(() => {
    const sess = sessionRef.current;
    setVideoTiles(sess ? sess.videoTiles() : []);
    setCamOn(sess?.isCameraOn() ?? false);
    setScreenOn(sess?.isScreenSharing() ?? false);
  }, []);

  // Leaving the panel (sign-out) must drop the session.
  useEffect(
    () => () => {
      if (audioUnlockTimer.current) clearTimeout(audioUnlockTimer.current);
      clearPruneTimers();
      void sessionRef.current?.disconnect();
      sessionRef.current = null;
    },
    [clearPruneTimers],
  );

  const disconnect = useCallback(async () => {
    intentionalLeaveRef.current = true;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    clearPruneTimers();
    await sessionRef.current?.disconnect().catch(() => undefined);
    sessionRef.current = null;
    joinedCodeRef.current = null;
    connectingCodeRef.current = null;
    pendingShareCodeRef.current = null;
    guestRoomRef.current = null;
  }, [clearPruneTimers]);

  const resetLiveUi = useCallback(() => {
    if (audioUnlockTimer.current) {
      clearTimeout(audioUnlockTimer.current);
      audioUnlockTimer.current = null;
    }
    clearPruneTimers();
    setSpeaking({});
    setStatus("");
    setMuted(false);
    setDeafened(false);
    setVideoTiles([]);
    setCamOn(false);
    setScreenOn(false);
    setVolumes({});
    setNeedsAudioUnlock(false);
  }, [clearPruneTimers]);

  const onAudioPlayback = useCallback((canPlay: boolean) => {
    if (audioUnlockTimer.current) {
      clearTimeout(audioUnlockTimer.current);
      audioUnlockTimer.current = null;
    }
    if (canPlay) {
      setNeedsAudioUnlock(false);
      return;
    }
    // Wait for scheduleResume bursts (0/200/600/1500) before offering a click.
    audioUnlockTimer.current = setTimeout(() => {
      const room = sessionRef.current?.room;
      if (room && !room.canPlaybackAudio) setNeedsAudioUnlock(true);
    }, 1800);
  }, []);

  const connect = useCallback(
    async (room: VoiceRoom, asGuest: boolean) => {
      intentionalLeaveRef.current = false;
      connectingRef.current = true;
      setStatus(asGuest ? "Connecting Unlim…" : MSG.voice.connectingVoice);
      let liveRoom = room;
      try {
        if (asGuest) {
          guestRoomRef.current = liveRoom;
          const portholeAttempts = 3;
          let portholeErr: unknown;
          for (let i = 0; i < portholeAttempts; i++) {
            const fresh =
              i === 0
                ? liveRoom
                : ((await getVoiceRoom(liveRoom.id).catch(() => null)) ??
                  guestRoomRef.current ??
                  liveRoom);
            const pendingCode = pendingShareCodeRef.current;
            pendingShareCodeRef.current = null;
            const code =
              pendingCode?.trim() || fresh.portholeShareCode?.trim() || "";
            if (!code) {
              portholeErr = new Error(
                "Room has no share code yet — ask the host to wait for the lobby code",
              );
              if (i < portholeAttempts - 1) {
                setStatus("Waiting for host lobby code…");
                await new Promise((r) => setTimeout(r, 800));
                continue;
              }
              throw portholeErr;
            }
            liveRoom = { ...fresh, portholeShareCode: code };
            guestRoomRef.current = liveRoom;
            connectingCodeRef.current = code;
            if (i > 0) {
              setStatus(
                `Connecting Unlim… (retry ${i + 1}/${portholeAttempts})`,
              );
              await new Promise((r) => setTimeout(r, 600 * i));
            }
            try {
              // Drop a stale join tunnel before binding the new key.
              await voiceGuestDisconnect().catch(() => undefined);
              await voiceGuestConnect(code);
              portholeErr = null;
              break;
            } catch (err) {
              portholeErr = err;
              connectingCodeRef.current = null;
              void netLog(
                "ui",
                `voice guest porthole try=${i + 1} FAILED: ${errorMessage(err)}`,
              );
            }
          }
          if (portholeErr) throw portholeErr;
          // Brief settle — WS can race the bind even after TCP accept.
          await new Promise((r) => setTimeout(r, 250));
          setStatus(MSG.voice.connectingVoice);
        }
        const session = new VoiceSession({
          onParticipants: () => {
            setStateTick((t) => t + 1);
            void listRoomMembers(liveRoom.id).then(setMembers);
          },
          onVideo: () => {
            refreshVideo();
          },
          onSpeaking: (id, on) => setSpeaking((prev) => ({ ...prev, [id]: on })),
          onAudioPlayback,
          onRemoteJoined: (identity) => {
            const pending = pruneTimers.current.get(identity);
            if (pending) {
              clearTimeout(pending);
              pruneTimers.current.delete(identity);
            }
          },
          onRemoteLeft: (identity) => {
            const prev = pruneTimers.current.get(identity);
            if (prev) clearTimeout(prev);
            const timer = setTimeout(() => {
              pruneTimers.current.delete(identity);
              const sess = sessionRef.current;
              if (sess?.participantIds().includes(identity)) return;
              void leaveVoiceRoom(liveRoom.id, identity)
                .then(() => listRoomMembers(liveRoom.id).then(setMembers))
                .catch(() => undefined);
            }, REMOTE_LEAVE_GRACE_MS);
            pruneTimers.current.set(identity, timer);
          },
          onDisconnected: () => {
            clearPruneTimers();
            setVideoTiles([]);
            setCamOn(false);
            setScreenOn(false);
            setSpeaking({});
            setNeedsAudioUnlock(false);
            joinedCodeRef.current = null;
            if (asGuest && !intentionalLeaveRef.current) {
              // Steam profile static_code never changes — we join via lobby:<id>.
              // Host rebuild (Open to LAN) kills the tunnel; rejoin by force, not
              // by waiting for a "new share code" string.
              setStatus("Lobby changed — reconnecting…");
              void netLog("ui", "voice guest disconnected — force reconnect loop");
              if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
              reconnectTimer.current = setTimeout(() => {
                void reconnectFnRef
                  .current({ force: true })
                  .catch(() => undefined);
              }, RECONNECT_GRACE_MS);
              return;
            }
            onRoomStatusChange?.(false);
            if (asGuest) {
              void leaveVoiceRoom(liveRoom.id, userId)
                .then(() => listRoomMembers(liveRoom.id).then(setMembers))
                .catch(() => undefined);
              setStatus("Disconnected — Leave or rejoin from the lobby");
            } else {
              setStatus(
                "Voice disconnected — try Leave, then Create again if needed",
              );
            }
          },
          onError: (m) => onToast(m, "err"),
        });
        const wsUrl = (liveRoom.lkWsUrl || "ws://127.0.0.1:7880").replace(
          "ws://localhost:",
          "ws://127.0.0.1:",
        );
        const connectOpts = {
          wsUrl,
          roomId: liveRoom.id,
          identity: userId,
          name: displayName,
          micDeviceId: micId || undefined,
          outputDeviceId: outputId || undefined,
        };
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
            if (
              !/signal|unreachable|Load failed|timeout|refused|WebRTC/i.test(msg)
            ) {
              throw err;
            }
          }
        }
        if (lastErr) throw lastErr;
        sessionRef.current = session;
        if (asGuest && connectingCodeRef.current) {
          joinedCodeRef.current = connectingCodeRef.current;
        }
        setMuted(false);
        setDeafened(false);
        setNeedsAudioUnlock(false);
        setStatus("In voice");
        refreshVideo();
        setStateTick((t) => t + 1);
        onAudioPlayback(session.room?.canPlaybackAudio ?? true);
        onRoomStatusChange?.(true);
      } finally {
        connectingRef.current = false;
        connectingCodeRef.current = null;
        const pending = pendingShareCodeRef.current;
        if (
          asGuest &&
          pending &&
          pending !== joinedCodeRef.current &&
          !reconnectingRef.current
        ) {
          pendingShareCodeRef.current = null;
          queueMicrotask(() => {
            void reconnectFnRef.current({ force: true }).catch(() => undefined);
          });
        }
      }
    },
    [
      clearPruneTimers,
      displayName,
      micId,
      onAudioPlayback,
      onRoomStatusChange,
      onToast,
      outputId,
      refreshVideo,
      setMembers,
      userId,
    ],
  );

  const reconnectGuest = useCallback(
    async (opts?: { force?: boolean }) => {
      if (reconnectingRef.current) return;
      const base = guestRoomRef.current;
      if (!base) return;
      reconnectingRef.current = true;
      setStatus("Reconnecting to host lobby…");
      // Swallow LiveKit onDisconnected side-effects while we cycle joins.
      intentionalLeaveRef.current = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      await sessionRef.current?.disconnect().catch(() => undefined);
      sessionRef.current = null;
      joinedCodeRef.current = null;

      let lastErr: unknown;
      try {
        for (let i = 0; i < RECONNECT_TRIES; i++) {
          if (i > 0) {
            setStatus(`Reconnecting… (${i + 1}/${RECONNECT_TRIES})`);
            await new Promise((r) => setTimeout(r, 1500));
          }
          const fresh = await getVoiceRoom(base.id).catch(() => null);
          const room = fresh
            ? { ...base, ...fresh }
            : (guestRoomRef.current ?? base);
          guestRoomRef.current = room;
          const code = room.portholeShareCode?.trim();
          if (!code) {
            lastErr = new Error("no lobby:<id> from host yet");
            continue;
          }
          if (
            !opts?.force &&
            code === joinedCodeRef.current &&
            sessionRef.current
          ) {
            return;
          }
          void netLog(
            "ui",
            `voice guest reconnect try=${i + 1} target=${code}`,
          );
          try {
            // connect() clears intentionalLeaveRef
            await connect(room, true);
            onToast("Rejoined voice after lobby update", "ok");
            return;
          } catch (err) {
            lastErr = err;
            sessionRef.current = null;
            intentionalLeaveRef.current = true;
            joinedCodeRef.current = null;
          }
        }
        intentionalLeaveRef.current = false;
        setStatus("Reconnect failed — Leave, then rejoin");
        onToast(`Voice reconnect failed: ${errorMessage(lastErr)}`, "err");
        void netLog(
          "ui",
          `voice guest reconnect FAILED: ${errorMessage(lastErr)}`,
        );
      } finally {
        reconnectingRef.current = false;
      }
    },
    [connect, onToast],
  );
  reconnectFnRef.current = reconnectGuest;

  /** Host published a new lobby:<id> after Voice+LAN merge — force rejoin. */
  const onHostShareCode = useCallback(
    (room: VoiceRoom, shareCode: string | null) => {
      const code = shareCode?.trim();
      if (!code) return;
      guestRoomRef.current = { ...room, portholeShareCode: code };
      // Same code we already joined or are joining — ignore Realtime echo.
      if (code === joinedCodeRef.current || code === connectingCodeRef.current) {
        return;
      }
      // First join / in-flight connect owns the tunnel — stash a newer lobby
      // and apply it after the attempt finishes (see connect finally).
      if (connectingRef.current || reconnectingRef.current) {
        pendingShareCodeRef.current = code;
        void netLog("ui", `voice guest defer lobby update target=${code}`);
        return;
      }
      // Not in voice yet — let the current/next connect() pick up guestRoomRef.
      if (!joinedCodeRef.current) return;
      void reconnectGuest({ force: true });
    },
    [reconnectGuest],
  );

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

  const unlockAudio = useCallback(() => {
    // Must call startAudio inside the click stack (autoplay gate).
    const room = sessionRef.current?.room;
    if (room) {
      void room
        .startAudio()
        .then(() => sessionRef.current?.resumePlayback())
        .then(() => {
          if (sessionRef.current?.room?.canPlaybackAudio) {
            setNeedsAudioUnlock(false);
          }
        })
        .catch(() => undefined);
      return;
    }
    void sessionRef.current?.resumePlayback();
  }, []);

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
    needsAudioUnlock,
    unlockAudio,
    connect,
    disconnect,
    reconnectGuest,
    onHostShareCode,
    resetLiveUi,
    toggleCamera,
    toggleScreen,
  };
}

export type LiveSession = ReturnType<typeof useLiveSession>;
