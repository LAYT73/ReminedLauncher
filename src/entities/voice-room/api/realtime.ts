import { supabase } from "@/shared/api/supabase";
import { TABLE } from "@/shared/config/supabase";
import type { PartyGameState, VoiceMessage } from "../model/types";

/**
 * Live chat inserts. Self-healing: if the channel errors, times out or closes
 * (sleeping socket, token refresh, hidden webview) it is torn down and
 * re-created with backoff. `onStatus` receives every transition; `onResubscribe`
 * fires after a re-created channel is SUBSCRIBED so callers can catch up.
 */
export function subscribeRoomChat(
  roomId: string,
  onInsert: (msg: VoiceMessage) => void,
  onStatus?: (status: string) => void,
  onResubscribe?: () => void,
): () => void {
  let disposed = false;
  let attempt = 0;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let everSubscribed = false;

  const open = () => {
    if (disposed) return;
    const gen = ++generation;
    const ch = supabase
      .channel(`voice-chat:${roomId}:${gen}`)
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
      .subscribe((status) => {
        if (disposed || gen !== generation) return;
        onStatus?.(status);
        if (status === "SUBSCRIBED") {
          attempt = 0;
          if (everSubscribed) onResubscribe?.();
          everSubscribed = true;
          return;
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          if (timer) return;
          const delay = Math.min(15_000, 1000 * 2 ** attempt++);
          timer = setTimeout(() => {
            timer = null;
            if (disposed) return;
            const old = channel;
            channel = null;
            if (old) void supabase.removeChannel(old);
            open();
          }, delay);
        }
      });
    channel = ch;
  };
  open();

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    if (channel) void supabase.removeChannel(channel);
    channel = null;
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

export type VoiceRoomRowPatch = {
  status?: string;
  relayShareCode?: string | null;
  packId?: string | null;
  gameState?: PartyGameState;
  lanPort?: number | null;
};

/** Fires when the room row changes (closed, new Relay share code, …). */
export function subscribeVoiceRoom(
  roomId: string,
  onChange: (patch: VoiceRoomRowPatch) => void,
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
        const row = payload.new as {
          status?: string;
          relay_share_code?: string | null;
          pack_id?: string | null;
          game_state?: PartyGameState;
          lan_port?: number | null;
        } | null;
        if (!row) return;
        onChange({
          status: row.status,
          relayShareCode:
            row.relay_share_code === undefined
              ? undefined
              : row.relay_share_code,
          packId: row.pack_id === undefined ? undefined : row.pack_id,
          gameState: row.game_state,
          lanPort: row.lan_port === undefined ? undefined : row.lan_port,
        });
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
