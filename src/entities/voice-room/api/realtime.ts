import { supabase } from "@/shared/api/supabase";
import { TABLE } from "@/shared/config/supabase";
import type { VoiceMessage } from "../model/types";

export function subscribeRoomChat(
  roomId: string,
  onInsert: (msg: VoiceMessage) => void,
): () => void {
  const channel = supabase
    .channel(`voice-chat:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: TABLE.voiceMessages,
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        const r = payload.new as {
          id: string;
          room_id: string;
          sender_id: string;
          body: string;
          created_at: string;
        };
        onInsert({
          id: r.id,
          roomId: r.room_id,
          senderId: r.sender_id,
          body: r.body,
          createdAt: r.created_at,
        });
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeInvites(
  userId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`voice-invites:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: TABLE.voiceInvites,
        filter: `to_id=eq.${userId}`,
      },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
