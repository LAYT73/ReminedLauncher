import { localizeServerError } from "@/shared/lib/errors";
import { supabase } from "@/shared/api/supabase";
import { TABLE } from "@/shared/config/supabase";
import type { VoiceRoom, VoiceRoomStatus } from "../model/types";
import { t } from "@/shared/i18n";
import { LIVEKIT_LOCAL_WS_URL, LIVEKIT_TCP_PORT } from "@/shared/config/voice";

type RoomRow = {
  id: string;
  host_id: string;
  title: string;
  status: VoiceRoomStatus;
  relay_share_code: string | null;
  lk_ws_url: string;
  lk_tcp_port: number;
  lk_udp_start: number;
  lk_udp_end: number;
  created_at: string;
};

function mapRoom(r: RoomRow): VoiceRoom {
  return {
    id: r.id,
    hostId: r.host_id,
    title: r.title,
    status: r.status,
    relayShareCode: r.relay_share_code,
    lkWsUrl: r.lk_ws_url || LIVEKIT_LOCAL_WS_URL,
    lkTcpPort: r.lk_tcp_port ?? LIVEKIT_TCP_PORT,
    lkUdpStart: r.lk_udp_start ?? 7882,
    lkUdpEnd: r.lk_udp_end ?? 7901,
    createdAt: r.created_at,
  };
}

export async function createVoiceRoom(opts: {
  hostId: string;
  title: string;
  shareCode: string;
  wsUrl: string;
  tcpPort: number;
  udpStart: number;
  udpEnd: number;
}): Promise<VoiceRoom> {
  const title = opts.title.trim() || "Voice room";
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(localizeServerError(authErr.message) || t("voice.errors.notSignedIn"));
  const hostId = authData.user?.id;
  if (!hostId) throw new Error(t("voice.errors.notSignedIn"));
  if (opts.hostId && opts.hostId !== hostId) {
    throw new Error(t("voice.errors.sessionMismatch"));
  }

  const { data, error } = await supabase
    .from(TABLE.voiceRooms)
    .insert({
      host_id: hostId,
      title,
      status: "open",
      relay_share_code: opts.shareCode,
      lk_ws_url: opts.wsUrl,
      lk_tcp_port: opts.tcpPort,
      lk_udp_start: opts.udpStart,
      lk_udp_end: opts.udpEnd,
    })
    .select("*")
    .single();
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.createRoom"));
  const room = mapRoom(data as RoomRow);
  const { error: mErr } = await supabase.from(TABLE.voiceRoomMembers).insert({
    room_id: room.id,
    user_id: hostId,
    role: "host",
  });
  if (mErr) throw new Error(localizeServerError(mErr.message) || t("voice.errors.joinAsHost"));
  return room;
}

export async function closeVoiceRoom(roomId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE.voiceRooms)
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", roomId);
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.closeRoom"));
  // Drop pending invites so they don't hang on friends' Voice tab.
  const { error: invErr } = await supabase
    .from(TABLE.voiceInvites)
    .delete()
    .eq("room_id", roomId);
  if (invErr) {
    // Fallback if DELETE is blocked by RLS — mark pending as declined.
    const { error: markErr } = await supabase
      .from(TABLE.voiceInvites)
      .update({ status: "declined" })
      .eq("room_id", roomId)
      .eq("status", "pending");
    if (markErr) {
      throw new Error(localizeServerError(markErr.message) || t("voice.errors.clearInvites"));
    }
  }
  // Purge membership so closed rooms never resurrect ghost members in lists.
  const { error: mErr } = await supabase
    .from(TABLE.voiceRoomMembers)
    .delete()
    .eq("room_id", roomId);
  if (mErr) throw new Error(localizeServerError(mErr.message) || t("voice.errors.clearMembers"));
}

export async function setVoiceRoomShareCode(
  roomId: string,
  shareCode: string,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE.voiceRooms)
    .update({
      relay_share_code: shareCode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", roomId);
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.saveShareCode"));
}

export async function leaveVoiceRoom(
  roomId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE.voiceRoomMembers)
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.leaveRoom"));
}

/** Re-assert membership after LiveKit reconnect (chat + member list need the row). */
export async function ensureVoiceRoomMember(
  roomId: string,
  userId: string,
  role: "host" | "member" = "member",
): Promise<void> {
  const { error } = await supabase.from(TABLE.voiceRoomMembers).upsert(
    { room_id: roomId, user_id: userId, role },
    { onConflict: "room_id,user_id" },
  );
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.joinRoom"));
}

export async function listMyOpenRooms(userId: string): Promise<VoiceRoom[]> {
  const { data: memberRows, error: mErr } = await supabase
    .from(TABLE.voiceRoomMembers)
    .select("room_id")
    .eq("user_id", userId);
  if (mErr) throw new Error(localizeServerError(mErr.message) || t("voice.errors.loadMemberships"));
  const ids = (memberRows ?? []).map((r) => r.room_id as string);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from(TABLE.voiceRooms)
    .select("*")
    .in("id", ids)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.loadRooms"));
  return (data ?? []).map((r) => mapRoom(r as RoomRow));
}

export async function getVoiceRoom(roomId: string): Promise<VoiceRoom | null> {
  const { data, error } = await supabase
    .from(TABLE.voiceRooms)
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.loadRoom"));
  return data ? mapRoom(data as RoomRow) : null;
}
