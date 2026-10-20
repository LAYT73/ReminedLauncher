import { supabase } from "@/shared/api/supabase";
import { TABLE } from "@/shared/config/supabase";
import type { VoiceInvite, VoiceInviteStatus, VoiceRoom } from "../model/types";
import { getVoiceRoom } from "./rooms";
import { FALLBACK_USERNAME } from "@/shared/config/limits";

export async function inviteFriendToRoom(opts: {
  roomId: string;
  fromId: string;
  toId: string;
}): Promise<void> {
  const { error } = await supabase.from(TABLE.voiceInvites).upsert(
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
    .from(TABLE.voiceInvites)
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
    supabase
      .from(TABLE.voiceRooms)
      .select("id, title, status")
      .in("id", roomIds),
    supabase
      .from(TABLE.profiles)
      .select("id, username, nick, skin_path")
      .in("id", fromIds),
  ]);
  const openRooms = new Map(
    (rooms ?? [])
      .filter((r) => (r.status as string) === "open")
      .map((r) => [r.id as string, (r.title as string) || "Voice room"]),
  );
  const profileBy = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      {
        name: ((p.username as string) || (p.nick as string) || FALLBACK_USERNAME).trim(),
        skin: (p.skin_path as string | null) ?? null,
      },
    ]),
  );

  // Hide invites whose room was closed (host left without invite cleanup).
  return rows
    .filter((r) => openRooms.has(r.room_id as string))
    .map((r) => {
      const from = profileBy.get(r.from_id as string);
      return {
        id: r.id as string,
        roomId: r.room_id as string,
        fromId: r.from_id as string,
        toId: r.to_id as string,
        status: r.status as VoiceInviteStatus,
        createdAt: r.created_at as string,
        roomTitle: openRooms.get(r.room_id as string),
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
    .from(TABLE.voiceInvites)
    .update({ status: accept ? "accepted" : "declined" })
    .eq("id", inviteId)
    .eq("to_id", userId)
    .select("room_id")
    .maybeSingle();
  if (error) throw new Error(error.message || "Could not update invite");
  if (!accept || !inv) return null;
  const roomId = inv.room_id as string;
  const { error: mErr } = await supabase.from(TABLE.voiceRoomMembers).upsert(
    { room_id: roomId, user_id: userId, role: "member" },
    { onConflict: "room_id,user_id" },
  );
  if (mErr) throw new Error(mErr.message || "Could not join room");
  return getVoiceRoom(roomId);
}
