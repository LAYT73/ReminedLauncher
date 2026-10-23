import { useEffect, useRef, useState } from "react";
import {
  listMessages,
  VOICE_MESSAGE_PAGE_SIZE,
  listRoomMembers,
  subscribeRoomChat,
  subscribeRoomMembers,
  type VoiceMember,
  type VoiceMessage,
  type VoiceRoom,
} from "@/entities/voice-room";
import { voiceLog } from "../api/voiceNative";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { sendGameNotifyWithHead } from "@/entities/skin";
import { useGameBridgePrefs } from "@/shared/lib/gameBridgePrefs";
import { useGameBridgeStore } from "@/shared/lib/gameBridgeStore";
import { TIMING } from "@/shared/config/timings";

const CHAT_TOAST_MAX = 80;

/** The joined room plus its members and chat (live-subscribed). */
export function useRoomData(userId: string, displayName: string) {
  const [active, setActive] = useState<VoiceRoom | null>(null);
  const [members, setMembers] = useState<VoiceMember[]>([]);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const membersRef = useRef<VoiceMember[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  membersRef.current = members;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!active) return;
    const roomId = active.id;
    let disposed = false;

    const decorate = (msg: VoiceMessage): VoiceMessage => {
      const member = membersRef.current.find((m) => m.userId === msg.senderId);
      return {
        ...msg,
        senderName:
          msg.senderName ||
          member?.username ||
          (msg.senderId === userId ? displayName : FALLBACK_USERNAME),
        senderSkinPath: msg.senderSkinPath ?? member?.skinPath ?? null,
      };
    };
    /** Merge by id, keep chronological order. */
    const merge = (incoming: VoiceMessage[]) => {
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const fresh = incoming.filter((m) => !known.has(m.id));
        if (fresh.length === 0) return prev;
        return [...prev, ...fresh.map(decorate)].sort((a, b) =>
          a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
        );
      });
    };
    const catchUp = () => {
      if (disposed) return;
      void listMessages(roomId, VOICE_MESSAGE_PAGE_SIZE)
        .then((rows) => {
          if (!disposed) merge(rows);
        })
        .catch(() => undefined);
    };

    const unsub = subscribeRoomChat(
      roomId,
      (msg) => {
        merge([msg]);
        if (
          msg.senderId === userId ||
          !useGameBridgeStore.getState().connected ||
          !useGameBridgePrefs.getState().notifications
        ) {
          return;
        }
        const name =
          msg.senderName ||
          membersRef.current.find((m) => m.userId === msg.senderId)?.username ||
          FALLBACK_USERNAME;
        const body = msg.body.length > CHAT_TOAST_MAX ? `${msg.body.slice(0, CHAT_TOAST_MAX - 1)}…` : msg.body;
        sendGameNotifyWithHead(
          { kind: "chat", title: name, body },
          { userId: msg.senderId, skinUrl: msg.senderSkinPath },
        );
      },
      (status) => {
        if (status !== "SUBSCRIBED") {
          void voiceLog("chat", `realtime ${roomId} status=${status}`);
        }
      },
      () => {
        void voiceLog("chat", `realtime ${roomId} resubscribed, catching up`);
        catchUp();
      },
    );

    // Safety net: realtime can die silently (sleeping socket, hidden webview).
    const poll = window.setInterval(catchUp, TIMING.voiceChatPoll);
    const onVis = () => {
      if (document.visibilityState === "visible") catchUp();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", catchUp);
    window.addEventListener("online", catchUp);
    return () => {
      disposed = true;
      unsub();
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", catchUp);
      window.removeEventListener("online", catchUp);
    };
  }, [active, userId, displayName, membersRef]);

  useEffect(() => {
    if (!active) return;
    const roomId = active.id;
    const refresh = () => {
      void listRoomMembers(roomId)
        .then(setMembers)
        .catch(() => undefined);
    };
    refresh();
    return subscribeRoomMembers(roomId, refresh);
  }, [active]);

  function reset() {
    setActive(null);
    setMessages([]);
    setMembers([]);
  }

  return {
    active,
    setActive,
    members,
    setMembers,
    messages,
    setMessages,
    membersRef,
    chatEndRef,
    reset,
  };
}
