import { supabase } from "./supabase";

export type VoiceRoomStatus = "open" | "closed";
export type VoiceInviteStatus = "pending" | "accepted" | "declined";
export type VoiceMemberRole = "host" | "member";

export type VoiceRoom = {
  id: string;
  hostId: string;
  title: string;
  status: VoiceRoomStatus;
  portholeShareCode: string | null;
  lkWsUrl: string;
  lkTcpPort: number;
  lkUdpStart: number;
  lkUdpEnd: number;
  createdAt: string;
};

export type VoiceInvite = {
  id: string;
  roomId: string;
  fromId: string;
  toId: string;
  status: VoiceInviteStatus;
  createdAt: string;
  roomTitle?: string;
  fromName?: string;
  fromSkinPath?: string | null;
};

export type VoiceMessage = {
  id: string;
  roomId: string;
  senderId: string;
  body: string;
  createdAt: string;
  senderName?: string;
  senderSkinPath?: string | null;
};

export type VoiceMember = {
  userId: string;
  role: VoiceMemberRole;
  joinedAt: string;
  username?: string;
  skinPath?: string | null;
};

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
    lkUdpStart: r.lk_udp_start ?? 7881,
    lkUdpEnd: r.lk_udp_end ?? 7890,
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
    .from("voice_rooms")
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
  const { error: mErr } = await supabase.from("voice_room_members").insert({
    room_id: room.id,
    user_id: hostId,
    role: "host",
  });
  if (mErr) throw new Error(mErr.message || "Could not join as host");
  return room;
}

export async function closeVoiceRoom(roomId: string): Promise<void> {
  const { error } = await supabase
    .from("voice_rooms")
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", roomId);
  if (error) throw new Error(error.message || "Could not close room");
}

export async function setVoiceRoomShareCode(
  roomId: string,
  shareCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("voice_rooms")
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
    .from("voice_room_members")
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message || "Could not leave room");
}

export async function listMyOpenRooms(userId: string): Promise<VoiceRoom[]> {
  const { data: memberRows, error: mErr } = await supabase
    .from("voice_room_members")
    .select("room_id")
    .eq("user_id", userId);
  if (mErr) throw new Error(mErr.message || "Could not load memberships");
  const ids = (memberRows ?? []).map((r) => r.room_id as string);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("voice_rooms")
    .select("*")
    .in("id", ids)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message || "Could not load rooms");
  return (data ?? []).map((r) => mapRoom(r as RoomRow));
}

export async function getVoiceRoom(roomId: string): Promise<VoiceRoom | null> {
  const { data, error } = await supabase
    .from("voice_rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new Error(error.message || "Could not load room");
  return data ? mapRoom(data as RoomRow) : null;
}

export async function inviteFriendToRoom(opts: {
  roomId: string;
  fromId: string;
  toId: string;
}): Promise<void> {
  const { error } = await supabase.from("voice_invites").upsert(
    {
      room_id: opts.roomId,
      from_id: opts.fromId,
      to_id: opts.toId,
      status: "pending",
    },
    { onConflict: "room_id,to_id" },
  );
  if (error) throw new Error(error.message || "Could not send invite");
}

export async function listPendingInvites(userId: string): Promise<VoiceInvite[]> {
  const { data, error } = await supabase
    .from("voice_invites")
    .select("id, room_id, from_id, to_id, status, created_at")
    .eq("to_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message || "Could not load invites");
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const roomIds = [...new Set(rows.map((r) => r.room_id as string))];
  const fromIds = [...new Set(rows.map((r) => r.from_id as string))];
  const [{ data: rooms }, { data: profiles }] = await Promise.all([
    supabase.from("voice_rooms").select("id, title").in("id", roomIds),
    supabase
      .from("profiles")
      .select("id, username, nick, skin_path")
      .in("id", fromIds),
  ]);
  const titleBy = new Map(
    (rooms ?? []).map((r) => [r.id as string, (r.title as string) || "Voice room"]),
  );
  const profileBy = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      {
        name: ((p.username as string) || (p.nick as string) || "Player").trim(),
        skin: (p.skin_path as string | null) ?? null,
      },
    ]),
  );

  return rows.map((r) => {
    const from = profileBy.get(r.from_id as string);
    return {
      id: r.id as string,
      roomId: r.room_id as string,
      fromId: r.from_id as string,
      toId: r.to_id as string,
      status: r.status as VoiceInviteStatus,
      createdAt: r.created_at as string,
      roomTitle: titleBy.get(r.room_id as string),
      fromName: from?.name,
      fromSkinPath: from?.skin ?? null,
    };
  });
}

export async function respondVoiceInvite(
  inviteId: string,
  accept: boolean,
  userId: string,
): Promise<VoiceRoom | null> {
  const { data: inv, error } = await supabase
    .from("voice_invites")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("id", inviteId)
    .eq("to_id", userId)
    .select("room_id")
    .maybeSingle();
  if (error) throw new Error(error.message || "Could not update invite");
  if (!accept || !inv) return null;
  const roomId = inv.room_id as string;
  const { error: mErr } = await supabase.from("voice_room_members").upsert(
    { room_id: roomId, user_id: userId, role: "member" },
    { onConflict: "room_id,user_id" },
  );
  if (mErr) throw new Error(mErr.message || "Could not join room");
  return getVoiceRoom(roomId);
}

export async function listRoomMembers(roomId: string): Promise<VoiceMember[]> {
  const { data, error } = await supabase
    .from("voice_room_members")
    .select("user_id, role, joined_at")
    .eq("room_id", roomId);
  if (error) throw new Error(error.message || "Could not load members");
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.user_id as string);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, nick, skin_path")
    .in("id", ids);
  const profileBy = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      {
        name: ((p.username as string) || (p.nick as string) || "Player").trim(),
        skin: (p.skin_path as string | null) ?? null,
      },
    ]),
  );
  return rows.map((r) => {
    const p = profileBy.get(r.user_id as string);
    return {
      userId: r.user_id as string,
      role: r.role as VoiceMemberRole,
      joinedAt: r.joined_at as string,
      username: p?.name,
      skinPath: p?.skin ?? null,
    };
  });
}

export async function listMessages(roomId: string, limit = 80): Promise<VoiceMessage[]> {
  const { data, error } = await supabase
    .from("voice_messages")
    .select("id, room_id, sender_id, body, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message || "Could not load messages");
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.sender_id as string))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, nick, skin_path")
    .in("id", ids);
  const profileBy = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      {
        name: ((p.username as string) || (p.nick as string) || "Player").trim(),
        skin: (p.skin_path as string | null) ?? null,
      },
    ]),
  );
  return rows.map((r) => {
    const p = profileBy.get(r.sender_id as string);
    return {
      id: r.id as string,
      roomId: r.room_id as string,
      senderId: r.sender_id as string,
      body: r.body as string,
      createdAt: r.created_at as string,
      senderName: p?.name,
      senderSkinPath: p?.skin ?? null,
    };
  });
}

export async function sendMessage(opts: {
  roomId: string;
  senderId: string;
  body: string;
}): Promise<VoiceMessage> {
  const body = opts.body.trim();
  if (!body) throw new Error("Empty message");
  const { data, error } = await supabase
    .from("voice_messages")
    .insert({
      room_id: opts.roomId,
      sender_id: opts.senderId,
      body: body.slice(0, 2000),
    })
    .select("id, room_id, sender_id, body, created_at")
    .single();
  if (error) throw new Error(error.message || "Could not send");
  return {
    id: data.id as string,
    roomId: data.room_id as string,
    senderId: data.sender_id as string,
    body: data.body as string,
    createdAt: data.created_at as string,
  };
}

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
        table: "voice_messages",
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
        table: "voice_invites",
        filter: `to_id=eq.${userId}`,
      },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
