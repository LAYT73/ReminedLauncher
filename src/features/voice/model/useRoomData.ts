import { useEffect, useRef, useState } from "react";
import {
  subscribeRoomChat,
  type VoiceMember,
  type VoiceMessage,
  type VoiceRoom,
} from "@/entities/voice-room";
import { FALLBACK_USERNAME } from "@/shared/config/limits";

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
    return subscribeRoomChat(active.id, (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const member = membersRef.current.find((m) => m.userId === msg.senderId);
        const name =
          member?.username || (msg.senderId === userId ? displayName : FALLBACK_USERNAME);
        return [
          ...prev,
          { ...msg, senderName: name, senderSkinPath: member?.skinPath ?? null },
        ];
      });
    });
  }, [active, userId, displayName]);

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
