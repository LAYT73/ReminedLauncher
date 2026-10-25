import { localizeServerError } from "@/shared/lib/errors";
import { supabase } from "@/shared/api/supabase";
import { TABLE } from "@/shared/config/supabase";
import type { VoiceInvite, VoiceInviteStatus, VoiceRoom } from "../model/types";
import { getVoiceRoom } from "./rooms";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { t } from "@/shared/i18n";
import { usePartyStore } from "../model/party-store";

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
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.sendInvite"));
}

/** Party invite (same row as a room invite). Marks the friend "Invited" in the party store. */
export async function inviteToParty(opts: {
  roomId: string;
  fromId: string;
  toId: string;
}): Promise<void> {
  await inviteFriendToRoom(opts);
  usePartyStore.getState().markInvited(opts.roomId, opts.toId);
}

export async function listPendingInvites(userId: string): Promise<VoiceInvite[]> {
  const { data, error } = await supabase
    .from(TABLE.voiceInvites)
    .select("id, room_id, from_id, to_id, status, created_at")
    .eq("to_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.loadInvites"));
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const roomIds = [...new Set(rows.map((r) => r.room_id as string))];
  const fromIds = [...new Set(rows.map((r) => r.from_id as string))];
  const [{ data: rooms }, { data: profiles }] = await Promise.all([
    supabase
      .from(TABLE.voiceRooms)
      .select("id, title, status, pack_id")
      .in("id", roomIds),
    supabase
      .from(TABLE.profiles)
      .select("id, username, nick, skin_path")
      .in("id", fromIds),
  ]);
  const openRooms = new Map(
    (rooms ?? [])
      .filter((r) => (r.status as string) === "open")
      .map((r) => [r.id as string, (r.title as string) || t("voice.voiceRoom")]),
  );
  const roomPacks = new Map(
    (rooms ?? []).map((r) => [r.id as string, (r.pack_id as string | null) ?? null]),
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
        roomPackId: roomPacks.get(r.room_id as string) ?? null,
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
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.updateInvite"));
  if (!accept || !inv) return null;
  const roomId = inv.room_id as string;
  const { error: mErr } = await supabase.from(TABLE.voiceRoomMembers).upsert(
    { room_id: roomId, user_id: userId, role: "member" },
    { onConflict: "room_id,user_id" },
  );
  if (mErr) throw new Error(localizeServerError(mErr.message) || t("voice.errors.joinRoom"));
  return getVoiceRoom(roomId);
}
