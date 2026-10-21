import { useCallback, useEffect, useRef, useState } from "react";
import {
  ensureVoiceRoomMember,
  getVoiceRoom,
  leaveVoiceRoom,
  listRoomMembers,
  type VoiceMember,
  type VoiceRoom,
} from "@/entities/voice-room";
import { netLog } from "@/shared/api/netLog";
import { relaySessionCore } from "@/shared/api/relay";
import { setVoiceRoomShareCode } from "@/entities/voice-room";
import { useGameStore } from "@/entities/game";
import {
  voiceGuestConnect,
  voiceGuestDisconnect,
  voiceStartLivekit,
  voiceStartRelay,
} from "../api/voiceNative";
import { VoiceSession, type VoiceVideoTile } from "../lib/voiceSession";
import { errorMessage, type ToastFn } from "./types";
import { MSG } from "@/shared/config/messages";

/** Long enough to cover guest Relay/LiveKit reconnect after host opens LAN. */
const REMOTE_LEAVE_GRACE_MS = 25_000;
const RECONNECT_GRACE_MS = 2000;
const RECONNECT_TRIES = 6;

type Args = {
  userId: string;
  displayName: string;
  onToast: ToastFn;
  onRoomStatusChange?: (inRoom: boolean) => void;
  setMembers: (members: VoiceMember[]) => void;
  /** Host tunnel key changed after auto-reconnect — keep room UI in sync. */
  onHostShareCodeRepublished?: (roomId: string, shareCode: string) => void;
  /** Guest: Supabase room closed / vanished — clear lobby UI even off the Voice tab. */
  onRoomEnded?: (reason: "closed" | "missing") => void;
};

/** The LiveKit session and everything that mirrors it into UI state. */
export function useLiveSession({
  userId,
  displayName,
  onToast,
  onRoomStatusChange,
  setMembers,
  onHostShareCodeRepublished,
  onRoomEnded,
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
  const hostRoomRef = useRef<VoiceRoom | null>(null);
  const roleRef = useRef<"host" | "guest" | null>(null);
  const intentionalLeaveRef = useRef(false);
  const reconnectingRef = useRef(false);
  /** True while connect()/voiceGuestConnect is in flight. */
  const connectingRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectFnRef = useRef<(opts?: { force?: boolean }) => Promise<void>>(
    async () => undefined,
  );
  const shareRepublishRef = useRef(onHostShareCodeRepublished);
  shareRepublishRef.current = onHostShareCodeRepublished;
  const onRoomEndedRef = useRef(onRoomEnded);
  onRoomEndedRef.current = onRoomEnded;
  /** Set when host ends the room — aborts in-flight guest reconnect. */
  const roomEndedRef = useRef(false);

  const clearPruneTimers = useCallback(() => {
    for (const t of pruneTimers.current.values()) clearTimeout(t);
    pruneTimers.current.clear();
  }, []);

  /** Guest: room row closed or no longer readable (members purged) → stop reconnect. */
  const checkGuestRoomAlive = useCallback(async (roomId: string) => {
    const fresh = await getVoiceRoom(roomId).catch(() => null);
    if (fresh && fresh.status !== "closed") return fresh;
    roomEndedRef.current = true;
    intentionalLeaveRef.current = true;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    reconnectingRef.current = false;
    guestRoomRef.current = null;
    await sessionRef.current?.disconnect().catch(() => undefined);
    sessionRef.current = null;
    joinedCodeRef.current = null;
    connectingCodeRef.current = null;
    pendingShareCodeRef.current = null;
    await voiceGuestDisconnect().catch(() => undefined);
    onRoomEndedRef.current?.(fresh?.status === "closed" ? "closed" : "missing");
    return null;
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
    roomEndedRef.current = true;
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
    hostRoomRef.current = null;
    roleRef.current = null;
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
      roomEndedRef.current = false;
      connectingRef.current = true;
      roleRef.current = asGuest ? "guest" : "host";
      setStatus(asGuest ? "Connecting Relay…" : MSG.voice.connectingVoice);
      let liveRoom = room;
      try {
        if (!asGuest) hostRoomRef.current = liveRoom;
        if (asGuest) {
          guestRoomRef.current = liveRoom;
          const relayAttempts = 3;
          let relayErr: unknown;
          for (let i = 0; i < relayAttempts; i++) {
            const fresh =
              i === 0
                ? liveRoom
                : ((await getVoiceRoom(liveRoom.id).catch(() => null)) ??
                  guestRoomRef.current ??
                  liveRoom);
            const pendingCode = pendingShareCodeRef.current;
            pendingShareCodeRef.current = null;
            const code =
              pendingCode?.trim() || fresh.relayShareCode?.trim() || "";
            if (!code) {
              relayErr = new Error(
                "Room has no share code yet — ask the host to wait for the lobby code",
              );
              if (i < relayAttempts - 1) {
                setStatus("Waiting for host lobby code…");
                await new Promise((r) => setTimeout(r, 800));
                continue;
              }
              throw relayErr;
            }
            liveRoom = { ...fresh, relayShareCode: code };
            guestRoomRef.current = liveRoom;
            connectingCodeRef.current = code;
            if (i > 0) {
              setStatus(
                `Connecting Relay… (retry ${i + 1}/${relayAttempts})`,
              );
              await new Promise((r) => setTimeout(r, 600 * i));
            }
            try {
              // Drop a stale join tunnel before binding the new key.
              await voiceGuestDisconnect().catch(() => undefined);
              await voiceGuestConnect(code);
              relayErr = null;
              break;
            } catch (err) {
              relayErr = err;
              connectingCodeRef.current = null;
              void netLog(
                "ui",
                `voice guest relay try=${i + 1} FAILED: ${errorMessage(err)}`,
              );
            }
          }
          if (relayErr) throw relayErr;
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
            // While we are cycling LiveKit ourselves, ignore remote blips —
            // pruning here would delete guests who are mid-reconnect.
            if (reconnectingRef.current) return;
            const prev = pruneTimers.current.get(identity);
            if (prev) clearTimeout(prev);
            const timer = setTimeout(() => {
              pruneTimers.current.delete(identity);
              if (reconnectingRef.current) return;
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
            sessionRef.current = null;
            // reconnectGuest/Host own this disconnect — keep Supabase membership
            // so chat + member list survive Relay/LAN tunnel rebuilds.
            if (reconnectingRef.current || roomEndedRef.current) {
              return;
            }
            if (!intentionalLeaveRef.current) {
              // Host Leave often kills LiveKit before (or without) the guest
              // seeing the Realtime "closed" event — especially off the Voice
              // tab. Probe Supabase before auto-reconnect so we don't stick
              // the guest alone in a dead room UI.
              if (asGuest) {
                void (async () => {
                  const alive = await checkGuestRoomAlive(liveRoom.id);
                  if (!alive || roomEndedRef.current || intentionalLeaveRef.current) {
                    return;
                  }
                  setStatus("Lobby changed — reconnecting…");
                  void netLog(
                    "ui",
                    "voice guest disconnected — force reconnect loop",
                  );
                  if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
                  reconnectTimer.current = setTimeout(() => {
                    void reconnectFnRef
                      .current({ force: true })
                      .catch(() => undefined);
                  }, RECONNECT_GRACE_MS);
                })();
                return;
              }
              setStatus("Voice dropped — reconnecting…");
              void netLog("ui", "voice host disconnected — auto reconnect");
              if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
              reconnectTimer.current = setTimeout(() => {
                void reconnectFnRef
                  .current({ force: true })
                  .catch(() => undefined);
              }, RECONNECT_GRACE_MS);
              return;
            }
            onRoomStatusChange?.(false);
            // Intentional leave/close: clear status. Do not leave a sticky
            // "In voice" / disconnect banner on the lobby after resetLiveUi.
            setStatus("");
            if (asGuest) {
              void leaveVoiceRoom(liveRoom.id, userId)
                .then(() => listRoomMembers(liveRoom.id).then(setMembers))
                .catch(() => undefined);
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
        // LiveKit can survive a tunnel rebuild while Supabase membership was
        // pruned (or never re-asserted). Chat + member list need the row.
        // Never upsert into a closed room (that resurrected ghost guests).
        if (asGuest) {
          const stillOpen = await checkGuestRoomAlive(liveRoom.id);
          if (!stillOpen) return;
          await ensureVoiceRoomMember(liveRoom.id, userId, "member")
            .then(() => listRoomMembers(liveRoom.id).then(setMembers))
            .catch(() => undefined);
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
          !reconnectingRef.current &&
          !roomEndedRef.current &&
          !intentionalLeaveRef.current &&
          relaySessionCore(pending) !== relaySessionCore(joinedCodeRef.current)
        ) {
          pendingShareCodeRef.current = null;
          queueMicrotask(() => {
            void reconnectFnRef.current({ force: true }).catch(() => undefined);
          });
        } else if (pending) {
          pendingShareCodeRef.current = null;
        }
      }
    },
    [
      checkGuestRoomAlive,
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
      if (reconnectingRef.current || roomEndedRef.current) return;
      const base = guestRoomRef.current;
      if (!base) return;
      const alive = await checkGuestRoomAlive(base.id);
      if (!alive) return;
      reconnectingRef.current = true;
      setStatus("Reconnecting to host lobby…");
      // Do not treat this disconnect as Leave — membership must stay for chat.
      intentionalLeaveRef.current = false;
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
          if (roomEndedRef.current || intentionalLeaveRef.current) return;
          if (i > 0) {
            setStatus(`Reconnecting… (${i + 1}/${RECONNECT_TRIES})`);
            await new Promise((r) => setTimeout(r, 1500));
          }
          if (roomEndedRef.current || intentionalLeaveRef.current) return;
          const fresh = await checkGuestRoomAlive(base.id);
          if (!fresh) return;
          const room = { ...base, ...fresh };
          guestRoomRef.current = room;
          const code = room.relayShareCode?.trim();
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
            // connect() clears intentionalLeaveRef / roomEndedRef
            await connect(room, true);
            if (roomEndedRef.current) return;
            onToast("Rejoined voice after lobby update", "ok");
            return;
          } catch (err) {
            lastErr = err;
            sessionRef.current = null;
            joinedCodeRef.current = null;
          }
        }
        // Host gone / tunnel dead — don't leave the guest stuck in-room alone.
        const still = await checkGuestRoomAlive(base.id);
        if (!still) return;
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
    [checkGuestRoomAlive, connect, onToast],
  );

  /** Host: restart LiveKit (+ Relay if needed) after unexpected drop / tauri rebuild. */
  const reconnectHost = useCallback(async () => {
    if (reconnectingRef.current) return;
    const base = hostRoomRef.current;
    if (!base) return;
    reconnectingRef.current = true;
    // Keep membership; onDisconnected skips leave while reconnectingRef is set.
    intentionalLeaveRef.current = false;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    await sessionRef.current?.disconnect().catch(() => undefined);
    sessionRef.current = null;

    let lastErr: unknown;
    try {
      for (let i = 0; i < RECONNECT_TRIES; i++) {
        if (i > 0) {
          setStatus(`Reconnecting voice… (${i + 1}/${RECONNECT_TRIES})`);
          await new Promise((r) => setTimeout(r, 1500));
        } else {
          setStatus("Restoring voice server…");
        }
        void netLog("ui", `voice host reconnect try=${i + 1}`);
        try {
          await voiceStartLivekit();
          await connect(base, false);
          const liveLan = useGameStore.getState().hostingLan?.gamePort ?? null;
          const lanPort =
            typeof liveLan === "number" && liveLan >= 1024 ? liveLan : null;
          const ready = await voiceStartRelay(lanPort);
          const key = ready.share_code?.trim();
          if (key) {
            hostRoomRef.current = { ...base, relayShareCode: key };
            await setVoiceRoomShareCode(base.id, key).catch(() => undefined);
            shareRepublishRef.current?.(base.id, key);
          }
          onToast("Voice reconnected", "ok");
          void netLog("ui", "voice host reconnect ok");
          return;
        } catch (err) {
          lastErr = err;
          sessionRef.current = null;
        }
      }
      setStatus(
        "Voice disconnected — try Leave, then Create again if needed",
      );
      onToast(`Voice reconnect failed: ${errorMessage(lastErr)}`, "err");
      void netLog(
        "ui",
        `voice host reconnect FAILED: ${errorMessage(lastErr)}`,
      );
    } finally {
      reconnectingRef.current = false;
    }
  }, [connect, onToast]);

  reconnectFnRef.current = async (opts) => {
    if (roleRef.current === "host") {
      await reconnectHost();
      return;
    }
    await reconnectGuest(opts);
  };

  /** Host published a new relay session — force rejoin only if id/sk changed. */
  const onHostShareCode = useCallback(
    (room: VoiceRoom, shareCode: string | null) => {
      const code = shareCode?.trim();
      if (!code) return;
      guestRoomRef.current = { ...room, relayShareCode: code };
      // Same code we already joined or are joining — ignore Realtime echo.
      if (code === joinedCodeRef.current || code === connectingCodeRef.current) {
        return;
      }
      // LAN attach only changes the port suffix — keep LiveKit session.
      const nextCore = relaySessionCore(code);
      const joinedCore = relaySessionCore(joinedCodeRef.current);
      const connectingCore = relaySessionCore(connectingCodeRef.current);
      if (
        nextCore &&
        (nextCore === joinedCore || nextCore === connectingCore)
      ) {
        void netLog(
          "ui",
          `voice guest ignore LAN-only share update core=${nextCore}`,
        );
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
