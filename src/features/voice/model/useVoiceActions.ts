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
  type VoiceInvite,
  type VoiceRoom,
} from "@/entities/voice-room";
import { portholeStopJoin } from "@/shared/api/porthole";
import {
  voiceEnsureRuntime,
  voiceLog,
  voiceStartLivekit,
  voiceStartPorthole,
  voiceStopHost,
} from "../api/voiceNative";
import { errorMessage, type ToastFn } from "./types";
import type { LiveSession } from "./useLiveSession";
import type { useRoomData } from "./useRoomData";
import type { useRuntimeModal } from "./useRuntimeModal";
import type { useVoiceLists } from "./useVoiceLists";
import { MSG } from "@/shared/config/messages";

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
  const [title, setTitle] = useState("Squad");
  const [draft, setDraft] = useState("");
  const [invitePick, setInvitePick] = useState("");
  /** Sync lock — React `busy` can lag one frame and allow a double Create. */
  const createInFlight = useRef(false);
  const { active } = room;
  const isHost = active?.hostId === userId;
  const fail = (err: unknown) => onToast(errorMessage(err), "err");

  function resetActiveUi() {
    room.reset();
    live.resetLiveUi();
    onRoomStatusChange?.(false);
  }

  // Guest: when host Ends room, leave UI + Porthole (membership may linger until delete).
  const activeId = active?.id ?? null;
  const activeHostId = active?.hostId ?? null;
  useEffect(() => {
    if (!activeId || activeHostId === userId) return;
    return subscribeVoiceRoom(activeId, (status) => {
      if (status !== "closed") return;
      void (async () => {
        await leaveVoiceRoom(activeId, userId).catch(() => undefined);
        await live.disconnect().catch(() => undefined);
        await portholeStopJoin().catch(() => undefined);
        room.reset();
        live.resetLiveUi();
        onRoomStatusChange?.(false);
        await lists.refreshLists().catch(() => undefined);
        onToast("Host ended the room", "ok");
      })();
    });
  }, [
    activeId,
    activeHostId,
    userId,
    live,
    lists,
    onRoomStatusChange,
    onToast,
    room,
  ]);

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
      if (!asGuest) await voiceStopHost().catch(() => undefined);
      resetActiveUi();
      throw err;
    }
  }

  async function teardownFailedCreate(roomId: string | null) {
    await live.disconnect();
    await voiceStopHost().catch(() => undefined);
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
      onToast("Already in a voice room — leave it first", "err");
      return;
    }
    createInFlight.current = true;
    setBusy(true);
    runtime.begin();
    live.setStatus("Preparing voice…");
    let createdRoomId: string | null = null;
    const step = (message: string, percent: number) =>
      runtime.setState((prev) => ({
        ...prev,
        message,
        percent: Math.max(prev.percent, percent),
      }));
    const unlisten = await listen<{ phase: string; message: string; percent: number }>(
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
    try {
      // Clean leftover UI/session only — LiveKit reuse is handled in Rust.
      await live.disconnect();
      resetActiveUi();
      await voiceEnsureRuntime();
      step(MSG.voice.startingServer, 85);
      live.setStatus(MSG.voice.startingServer);
      // LiveKit first — host WebRTC must succeed before Porthole binds the same ports.
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
      step(MSG.voice.openingPorthole, 96);
      live.setStatus(MSG.voice.openingPorthole);
      const ready = await voiceStartPorthole();
      await setVoiceRoomShareCode(created.id, ready.share_code);
      room.setActive((prev) => ({
        ...(prev ?? created),
        portholeShareCode: ready.share_code,
      }));
      live.setStatus("In voice");
      runtime.close();
      onToast("Voice room live", "ok");
      unlockAchievement("first-voice-room", onToast);
    } catch (err) {
      await teardownFailedCreate(createdRoomId);
      const msg = errorMessage(err);
      void voiceLog("ui", `onCreate FAILED: ${msg}`);
      runtime.setState((prev) => ({
        ...prev,
        open: true,
        error: msg,
        percent: 0,
        message: "Failed",
      }));
    } finally {
      unlisten();
      createInFlight.current = false;
      setBusy(false);
    }
  }

  const onAcceptInvite = (inv: VoiceInvite) =>
    guarded(async () => {
      live.setStatus("Accepting invite…");
      try {
        // Switching rooms: leave the current one first so the old session/SFU
        // does not linger (and so we don't keep hosting a dead room).
        if (active && active.id !== inv.roomId) {
          if (active.hostId === userId) {
            await closeVoiceRoom(active.id).catch(() => undefined);
            voiceStopHost().catch(() => undefined);
          } else {
            await leaveVoiceRoom(active.id, userId).catch(() => undefined);
          }
          await live.disconnect();
          resetActiveUi();
        }
        const joined = await respondVoiceInvite(inv.id, true, userId);
        if (!joined) throw new Error("Room unavailable");
        // Host may still be publishing the Porthole code after create — poll briefly.
        let room = joined;
        for (let i = 0; i < 10 && !room.portholeShareCode; i++) {
          live.setStatus("Waiting for host lobby code…");
          await new Promise((r) => setTimeout(r, 500));
          room = (await getVoiceRoom(joined.id)) ?? room;
        }
        if (!room.portholeShareCode) {
          throw new Error(
            "Host lobby code is not ready yet — ask them to wait until the code appears, then re-accept",
          );
        }
        await openRoomSession(room, true);
        onToast("Joined voice room", "ok");
        unlockAchievement("first-voice-room", onToast);
      } catch (err) {
        void portholeStopJoin().catch(() => undefined);
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
        await portholeStopJoin().catch(() => undefined);
      }
      await live.sessionRef.current?.disconnect().catch(() => undefined);
      live.sessionRef.current = null;
      if (active && isHost) {
        await voiceStopHost().catch(() => undefined);
      }
      resetActiveUi();
      await lists.refreshLists();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function onInvite() {
    if (!active || !invitePick) return;
    if (!active.portholeShareCode) {
      onToast("Wait until the lobby code appears before inviting", "err");
      return;
    }
    try {
      await inviteFriendToRoom({ roomId: active.id, fromId: userId, toId: invitePick });
      setInvitePick("");
      onToast("Invite sent", "ok");
    } catch (err) {
      fail(err);
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
    guarded(() => openRoomSession(target, target.hostId !== userId));

  const onCloseListedRoom = (target: VoiceRoom) =>
    guarded(async () => {
      if (target.hostId === userId) {
        await closeVoiceRoom(target.id);
        void voiceStopHost();
        onToast("Room closed", "ok");
      } else {
        await leaveVoiceRoom(target.id, userId);
        onToast("Left room", "ok");
      }
      if (active?.id === target.id) {
        await live.disconnect();
        resetActiveUi();
      }
      await lists.refreshLists();
    });

  return {
    busy,
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
  };
}
