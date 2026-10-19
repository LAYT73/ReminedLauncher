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

/** Live member join/leave for an open room (keeps the grid in sync after Leave). */
export function subscribeRoomMembers(
  roomId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`voice-members:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: TABLE.voiceRoomMembers,
        filter: `room_id=eq.${roomId}`,
      },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Fires when the room row changes (e.g. host closed it). */
export function subscribeVoiceRoom(
  roomId: string,
  onChange: (status: string) => void,
): () => void {
  const channel = supabase
    .channel(`voice-room:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: TABLE.voiceRooms,
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        const status = (payload.new as { status?: string } | null)?.status;
        if (status) onChange(status);
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
