import { supabase } from "@/shared/api/supabase";
import { TABLE } from "@/shared/config/supabase";
import type { VoiceRoom, VoiceRoomStatus } from "../model/types";

type RoomRow = {
  id: string;
  host_id: string;
  title: string;
  status: VoiceRoomStatus;
  porthole_share_code: string | null;
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
    portholeShareCode: r.porthole_share_code,
    lkWsUrl: r.lk_ws_url || "ws://127.0.0.1:7880",
    lkTcpPort: r.lk_tcp_port ?? 7880,
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
  if (authErr) throw new Error(authErr.message || "Not signed in");
  const hostId = authData.user?.id;
  if (!hostId) throw new Error("Not signed in");
  if (opts.hostId && opts.hostId !== hostId) {
    throw new Error("Session user does not match host id");
  }

  const { data, error } = await supabase
    .from(TABLE.voiceRooms)
    .insert({
      host_id: hostId,
      title,
      status: "open",
      porthole_share_code: opts.shareCode,
      lk_ws_url: opts.wsUrl,
      lk_tcp_port: opts.tcpPort,
      lk_udp_start: opts.udpStart,
      lk_udp_end: opts.udpEnd,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message || "Could not create room");
  const room = mapRoom(data as RoomRow);
  const { error: mErr } = await supabase.from(TABLE.voiceRoomMembers).insert({
    room_id: room.id,
    user_id: hostId,
    role: "host",
  });
  if (mErr) throw new Error(mErr.message || "Could not join as host");
  return room;
}

export async function closeVoiceRoom(roomId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE.voiceRooms)
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", roomId);
  if (error) throw new Error(error.message || "Could not close room");
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
      throw new Error(markErr.message || "Could not clear room invites");
    }
  }
  // Purge membership so closed rooms never resurrect ghost members in lists.
  const { error: mErr } = await supabase
    .from(TABLE.voiceRoomMembers)
    .delete()
    .eq("room_id", roomId);
  if (mErr) throw new Error(mErr.message || "Could not clear room members");
}

export async function setVoiceRoomShareCode(
  roomId: string,
  shareCode: string,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE.voiceRooms)
    .update({
      porthole_share_code: shareCode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", roomId);
  if (error) throw new Error(error.message || "Could not save share code");
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
  if (error) throw new Error(error.message || "Could not leave room");
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
  if (error) throw new Error(error.message || "Could not join room");
}

export async function listMyOpenRooms(userId: string): Promise<VoiceRoom[]> {
  const { data: memberRows, error: mErr } = await supabase
    .from(TABLE.voiceRoomMembers)
    .select("room_id")
    .eq("user_id", userId);
  if (mErr) throw new Error(mErr.message || "Could not load memberships");
  const ids = (memberRows ?? []).map((r) => r.room_id as string);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from(TABLE.voiceRooms)
    .select("*")
    .in("id", ids)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message || "Could not load rooms");
  return (data ?? []).map((r) => mapRoom(r as RoomRow));
}

export async function getVoiceRoom(roomId: string): Promise<VoiceRoom | null> {
  const { data, error } = await supabase
    .from(TABLE.voiceRooms)
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new Error(error.message || "Could not load room");
  return data ? mapRoom(data as RoomRow) : null;
}
