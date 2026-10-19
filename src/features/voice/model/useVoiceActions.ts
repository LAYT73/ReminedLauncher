import { listen } from "@tauri-apps/api/event";
import { useState, type FormEvent } from "react";
import { EVENT } from "@/shared/config/events";
import { unlockAchievement } from "@/shared/lib/achievements";
import {
  closeVoiceRoom,
  createVoiceRoom,
  inviteFriendToRoom,
  leaveVoiceRoom,
  listMessages,
  listRoomMembers,
  respondVoiceInvite,
  sendMessage,
  setVoiceRoomShareCode,
  type VoiceInvite,
  type VoiceRoom,
} from "@/entities/voice-room";
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
  const { active } = room;
  const isHost = active?.hostId === userId;
  const fail = (err: unknown) => onToast(errorMessage(err), "err");

  function resetActiveUi() {
    room.reset();
    live.resetLiveUi();
    onRoomStatusChange?.(false);
  }

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
      if (!asGuest) voiceStopHost().catch(() => undefined);
      resetActiveUi();
      throw err;
    }
  }

  async function teardownFailedCreate(roomId: string | null) {
    await live.disconnect();
    voiceStopHost().catch(() => undefined);
    if (roomId) await closeVoiceRoom(roomId).catch(() => undefined);
    resetActiveUi();
    await lists.refreshLists().catch(() => undefined);
  }

  /** Run `task` with the busy flag set; errors are toasted. */
  async function guarded(task: () => Promise<void>) {
    if (busy) return;
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
    if (busy) return;
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
      // Clean leftover SFU / open rooms before a fresh create (Retry path).
      await teardownFailedCreate(null);
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
          await live.disconnect();
          if (active.hostId === userId) {
            await closeVoiceRoom(active.id).catch(() => undefined);
            voiceStopHost().catch(() => undefined);
          } else {
            await leaveVoiceRoom(active.id, userId).catch(() => undefined);
          }
          resetActiveUi();
        }
        const joined = await respondVoiceInvite(inv.id, true, userId);
        if (!joined) throw new Error("Room unavailable");
        await openRoomSession(joined, true);
        onToast("Joined voice room", "ok");
        unlockAchievement("first-voice-room", onToast);
      } catch (err) {
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
    setBusy(true);
    try {
      await live.sessionRef.current?.disconnect();
      live.sessionRef.current = null;
      if (active && isHost) {
        await closeVoiceRoom(active.id);
        void voiceStopHost();
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
