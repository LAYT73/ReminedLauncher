import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { EVENT } from "@/shared/config/events";
import { unlockAchievement } from "@/shared/lib/achievements";
import {
  closeVoiceRoom,
  createVoiceRoom,
  getVoiceRoom,
  inviteFriendToRoom,
  leaveVoiceRoom,
  listMessages,
  listRoomMembers,
  respondVoiceInvite,
  sendMessage,
  setVoiceRoomShareCode,
  subscribeVoiceRoom,
  useVoiceStatusStore,
  type VoiceInvite,
  type VoiceRoom,
} from "@/entities/voice-room";
import { useGameStore } from "@/entities/game";
import { ensureRelayReady } from "@/shared/api/relay";
import {
  voiceEnsureRuntime,
  voiceGuestDisconnect,
  voiceLog,
  voiceStartLivekit,
  voiceStartRelay,
  voiceStopHost,
} from "../api/voiceNative";
import { randomVoiceRoomTitle } from "../lib/roomName";
import { errorMessage } from "@/shared/lib/errors";
import type { ToastFn } from "./types";
import type { LiveSession } from "./useLiveSession";
import type { useRoomData } from "./useRoomData";
import type { useRuntimeModal } from "./useRuntimeModal";
import type { useVoiceLists } from "./useVoiceLists";
import { MSG } from "@/shared/config/messages";
import { t } from "@/shared/i18n";
import { TIMING } from "@/shared/config/timings";

function lanPortNow(): number | null {
  return useGameStore.getState().hostingLan?.gamePort ?? null;
}

/** Prefer already-published LAN; attach happens from game log. */
function reservedLanPort(): number | null {
  return lanPortNow();
}

type Args = {
  userId: string;
  displayName: string;
  onToast: ToastFn;
  onRoomStatusChange?: (inRoom: boolean) => void;
  room: ReturnType<typeof useRoomData>;
  live: LiveSession;
  lists: ReturnType<typeof useVoiceLists>;
  runtime: ReturnType<typeof useRuntimeModal>;
};

/** User intents of the voice panel: create / join / leave / invite / chat. */
export function useVoiceActions({
  userId,
  displayName,
  onToast,
  onRoomStatusChange,
  room,
  live,
  lists,
  runtime,
}: Args) {
  const [busy, setBusy] = useState(false);
  /** True only while Create is running — leave/close must not look like creating. */
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(() => randomVoiceRoomTitle());
  const [draft, setDraft] = useState("");
  const [invitePick, setInvitePick] = useState("");
  /** Sync lock — React `busy` can lag one frame and allow a double Create. */
  const createInFlight = useRef(false);
  const guestKickInFlight = useRef(false);
  const liveRef = useRef(live);
  liveRef.current = live;
  const roomRef = useRef(room);
  roomRef.current = room;
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const onRoomStatusChangeRef = useRef(onRoomStatusChange);
  onRoomStatusChangeRef.current = onRoomStatusChange;
  const { active } = room;
  const isHost = active?.hostId === userId;
  const fail = (err: unknown) => onToast(errorMessage(err, ""), "err");

  function resetActiveUi() {
    room.reset();
    live.resetLiveUi();
    useVoiceStatusStore.getState().setHostRoomId(null);
    onRoomStatusChange?.(false);
  }

  /** Host closed the room — clear guest UI even when Voice tab is display:none. */
  async function kickGuestRoomEnded(roomId: string, toastMsg = true) {
    if (guestKickInFlight.current) return;
    guestKickInFlight.current = true;
    try {
      await leaveVoiceRoom(roomId, userId).catch(() => undefined);
      await liveRef.current.disconnect().catch(() => undefined);
      await voiceGuestDisconnect().catch(() => undefined);
      roomRef.current.reset();
      liveRef.current.resetLiveUi();
      onRoomStatusChangeRef.current?.(false);
      await listsRef.current.refreshLists().catch(() => undefined);
      if (toastMsg) onToastRef.current(t("voice.toasts.hostEnded"), "ok");
    } finally {
      guestKickInFlight.current = false;
    }
  }

  async function stopHostKeepingLan() {
    const lan = lanPortNow();
    const keepRelay = lan != null;
    await voiceStopHost(lan, keepRelay).catch(() => undefined);
  }

  // Room row updates: host closed, or new Relay share code (Voice+LAN merge).
  // Keep deps stable (refs for live/room) — resubscribing on every speaking
  // tick drops the Realtime channel and misses "closed" while off the Voice tab.
  const activeId = active?.id ?? null;
  const activeHostId = active?.hostId ?? null;
  useEffect(() => {
    if (!activeId) return;
    return subscribeVoiceRoom(activeId, (patch) => {
      if (patch.status === "closed") {
        if (activeHostId === userId) return;
        void kickGuestRoomEnded(activeId);
        return;
      }
      if (patch.relayShareCode === undefined) return;
      const code = patch.relayShareCode;
      roomRef.current.setActive((prev) => {
        if (!prev || prev.id !== activeId) return prev;
        // Same-code Realtime echo must not force a guest rejoin — that kills
        // the in-flight Relay connect (localhost:7880 never opens).
        if (code === prev.relayShareCode) return prev;
        const next = { ...prev, relayShareCode: code };
        // Guests reconnect only when the relay *session* changes (id/sk),
        // not when a LAN port is merely appended to the share code.
        if (activeHostId !== userId && code) {
          queueMicrotask(() => liveRef.current.onHostShareCode(next, code));
        }
        return next;
      });
    });
  }, [activeId, activeHostId, userId]);

  // Backup while guest is in a room: poll so we still leave if Realtime missed
  // the closed event (common when Voice slot is display:none).
  useEffect(() => {
    if (!activeId || activeHostId === userId) return;
    let cancelled = false;
    const tick = () => {
      void getVoiceRoom(activeId)
        .then((r) => {
          if (cancelled) return;
          if (!r || r.status === "closed") {
            void kickGuestRoomEnded(activeId);
          }
        })
        .catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, TIMING.voiceRoomStatusPoll);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [activeId, activeHostId, userId]);

  async function openRoomSession(target: VoiceRoom, asGuest: boolean) {
    room.setActive(target);
    try {
      const [msgs, mems] = await Promise.all([
        listMessages(target.id),
        listRoomMembers(target.id),
      ]);
      room.setMessages(msgs);
      room.setMembers(mems);
      await live.connect(target, asGuest);
      await lists.refreshLists();
      onRoomStatusChange?.(true);
    } catch (err) {
      await live.disconnect();
      if (!asGuest) await stopHostKeepingLan();
      else await voiceGuestDisconnect().catch(() => undefined);
      resetActiveUi();
      throw err;
    }
  }

  async function teardownFailedCreate(roomId: string | null) {
    await live.disconnect();
    await stopHostKeepingLan();
    if (roomId) await closeVoiceRoom(roomId).catch(() => undefined);
    resetActiveUi();
    await lists.refreshLists().catch(() => undefined);
  }

  /** Run `task` with the busy flag set; errors are toasted. */
  async function guarded(task: () => Promise<void>) {
    if (busy || createInFlight.current) return;
    setBusy(true);
    try {
      await task();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    if (busy || createInFlight.current) return;
    if (active && live.sessionRef.current) {
      onToast(MSG.voice.alreadyInRoom, "err");
      return;
    }
    createInFlight.current = true;
    setCreating(true);
    setBusy(true);
    runtime.begin();
    live.setStatus(t("voice.s.preparingVoice"));
    let createdRoomId: string | null = null;
    const step = (message: string, percent: number) =>
      runtime.setState((prev) => ({
        ...prev,
        message,
        percent: Math.max(prev.percent, percent),
      }));
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{ phase: string; message: string; percent: number }>(
        EVENT.voiceRuntimeProgress,
        (ev) =>
          runtime.setState((prev) =>
            prev.open
              ? {
                  ...prev,
                  phase: ev.payload.phase || prev.phase,
                  message: ev.payload.message || prev.message,
                  percent: ev.payload.percent ?? prev.percent,
                  error: null,
                }
              : prev,
          ),
      );
      // Clean leftover UI/session only — LiveKit reuse is handled in Rust.
      await live.disconnect();
      resetActiveUi();
      step(t("voice.s.preparingRelay"), 20);
      live.setStatus(t("voice.s.preparingRelay"));
      await ensureRelayReady();
      await voiceEnsureRuntime();
      step(MSG.voice.startingServer, 85);
      live.setStatus(MSG.voice.startingServer);
      // LiveKit first — host WebRTC must succeed before Relay binds the same ports.
      const livekit = await voiceStartLivekit();
      const created = await createVoiceRoom({
        hostId: userId,
        title,
        shareCode: "",
        wsUrl: livekit.ws_url,
        tcpPort: livekit.tcp_port,
        udpStart: livekit.udp_start,
        udpEnd: livekit.udp_end,
      });
      createdRoomId = created.id;
      step(MSG.voice.connectingVoice, 93);
      await openRoomSession(created, false);
      useVoiceStatusStore.getState().setHostRoomId(created.id);
      step(MSG.voice.openingRelay, 96);
      live.setStatus(MSG.voice.openingRelay);
      const ready = await voiceStartRelay(reservedLanPort());
      await setVoiceRoomShareCode(created.id, ready.share_code);
      room.setActive((prev) => ({
        ...(prev ?? created),
        relayShareCode: ready.share_code,
      }));
      live.setStatus(t("voice.inVoice"));
      runtime.close();
      setTitle(randomVoiceRoomTitle());
      onToast(t("voice.toasts.roomLive"), "ok");
      unlockAchievement("first-voice-room", onToast);
    } catch (err) {
      await teardownFailedCreate(createdRoomId);
      const msg = errorMessage(err, "");
      void voiceLog("ui", `onCreate FAILED: ${msg}`);
      runtime.setState((prev) => ({
        ...prev,
        open: true,
        error: msg,
        percent: 0,
        message: t("voice.runtime.failed"),
      }));
    } finally {
      unlisten?.();
      createInFlight.current = false;
      setCreating(false);
      setBusy(false);
    }
  }

  const onAcceptInvite = (inv: VoiceInvite) =>
    guarded(async () => {
      live.setStatus(t("voice.s.acceptingInvite"));
      try {
        // Switching rooms: leave the current one first so the old session/SFU
        // does not linger (and so we don't keep hosting a dead room).
        if (active && active.id !== inv.roomId) {
          if (active.hostId === userId) {
            await closeVoiceRoom(active.id).catch(() => undefined);
            await stopHostKeepingLan();
          } else {
            await leaveVoiceRoom(active.id, userId).catch(() => undefined);
            await voiceGuestDisconnect().catch(() => undefined);
          }
          await live.disconnect();
          resetActiveUi();
        }
        const joined = await respondVoiceInvite(inv.id, true, userId);
        if (!joined) throw new Error(t("voice.errors.roomUnavailable"));
        live.setStatus(t("voice.s.preparingRelay"));
        await ensureRelayReady();
        // Host may still be publishing the Relay key after create — poll briefly.
        let room = joined;
        for (let i = 0; i < 10 && !room.relayShareCode; i++) {
          live.setStatus(t("voice.s.waitingShareKey"));
          await new Promise((r) => setTimeout(r, TIMING.hostKeyPoll));
          room = (await getVoiceRoom(joined.id)) ?? room;
        }
        if (!room.relayShareCode) {
          throw new Error(t("voice.errors.hostKeyNotReady"));
        }
        await openRoomSession(room, true);
        onToast(t("voice.toasts.joined"), "ok");
        unlockAchievement("first-voice-room", onToast);
      } catch (err) {
        void voiceGuestDisconnect().catch(() => undefined);
        resetActiveUi();
        throw err;
      }
    });

  async function onDeclineInvite(inv: VoiceInvite) {
    try {
      await respondVoiceInvite(inv.id, false, userId);
      await lists.refreshLists();
    } catch (err) {
      fail(err);
    }
  }

  async function onLeave() {
    if (createInFlight.current) return;
    setBusy(true);
    try {
      // Drop Supabase membership/room BEFORE LiveKit disconnect so the host's
      // ParticipantDisconnected → listRoomMembers refresh does not resurrect a ghost.
      if (active && isHost) {
        await closeVoiceRoom(active.id).catch(() => undefined);
      } else if (active) {
        await leaveVoiceRoom(active.id, userId).catch(() => undefined);
        await voiceGuestDisconnect().catch(() => undefined);
      }
      // Must use live.disconnect() — sets intentionalLeave so onDisconnected
      // does not schedule auto-reconnect and resurrect "In voice" + tab badge.
      await live.disconnect().catch(() => undefined);
      if (active && isHost) {
        await stopHostKeepingLan();
      }
      resetActiveUi();
      // Drop busy before list refresh so lobby Create doesn't flash "Starting…".
      setBusy(false);
      await lists.refreshLists();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function onInvite() {
    if (!active || !invitePick) return;
    if (!active.relayShareCode) {
      onToast(t("voice.toasts.waitLobbyCode"), "err");
      throw new Error(t("voice.errors.lobbyNotReady"));
    }
    try {
      await inviteFriendToRoom({ roomId: active.id, fromId: userId, toId: invitePick });
      setInvitePick("");
      onToast(t("voice.toasts.inviteSent"), "ok");
    } catch (err) {
      fail(err);
      throw err;
    }
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!active || !draft.trim()) return;
    const body = draft.trim();
    setDraft("");
    try {
      const msg = await sendMessage({ roomId: active.id, senderId: userId, body });
      const self = room.membersRef.current.find((m) => m.userId === userId);
      room.setMessages((prev) =>
        prev.some((m) => m.id === msg.id)
          ? prev
          : [
              ...prev,
              {
                ...msg,
                senderName: self?.username || displayName,
                senderSkinPath: self?.skinPath ?? null,
              },
            ],
      );
    } catch (err) {
      setDraft(body);
      fail(err);
    }
  }

  const onRejoin = (target: VoiceRoom) =>
    guarded(async () => {
      const asGuest = target.hostId !== userId;
      if (asGuest) {
        await openRoomSession(target, true);
        return;
      }
      // Host rejoin (e.g. after a launcher restart): the local LiveKit and the
      // old Relay tunnel are gone — start LiveKit (Rust reuses a live one),
      // connect to its current URL, then re-open Relay with a fresh share code.
      await voiceEnsureRuntime();
      const livekit = await voiceStartLivekit();
      const hostRoom = { ...target, wsUrl: livekit.ws_url };
      await openRoomSession(hostRoom, false);
      useVoiceStatusStore.getState().setHostRoomId(target.id);
      const ready = await voiceStartRelay(reservedLanPort());
      await setVoiceRoomShareCode(target.id, ready.share_code);
      room.setActive((prev) => ({
        ...(prev ?? hostRoom),
        relayShareCode: ready.share_code,
      }));
    });

  const onCloseListedRoom = (target: VoiceRoom) =>
    guarded(async () => {
      if (target.hostId === userId) {
        await closeVoiceRoom(target.id);
        await stopHostKeepingLan();
        onToast(t("voice.toasts.roomClosed"), "ok");
      } else {
        await leaveVoiceRoom(target.id, userId);
        await voiceGuestDisconnect().catch(() => undefined);
        onToast(t("voice.toasts.leftRoom"), "ok");
      }
      if (active?.id === target.id) {
        await live.disconnect();
        resetActiveUi();
      }
      await lists.refreshLists();
    });

  return {
    busy,
    creating,
    isHost,
    title,
    setTitle,
    draft,
    setDraft,
    invitePick,
    setInvitePick,
    onCreate,
    onAcceptInvite,
    onDeclineInvite,
    onLeave,
    onInvite,
    onSend,
    onRejoin,
    onCloseListedRoom,
    kickGuestRoomEnded,
  };
}
