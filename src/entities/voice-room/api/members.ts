import { localizeServerError } from "@/shared/lib/errors";
import { supabase } from "@/shared/api/supabase";
import { TABLE } from "@/shared/config/supabase";
import type {
  PartyMemberState,
  VoiceMember,
  VoiceMemberRole,
} from "../model/types";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { t } from "@/shared/i18n";

export async function listRoomMembers(roomId: string): Promise<VoiceMember[]> {
  const { data, error } = await supabase
    .from(TABLE.voiceRoomMembers)
    .select("user_id, role, joined_at, state, progress, updated_at")
    .eq("room_id", roomId);
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.loadMembers"));
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.user_id as string);
  const { data: profiles } = await supabase
    .from(TABLE.profiles)
    .select("id, username, nick, skin_path")
    .in("id", ids);
  const profileBy = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      {
        name: ((p.username as string) || (p.nick as string) || FALLBACK_USERNAME).trim(),
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
      state: (r.state as PartyMemberState | null) ?? "joined",
      progress: (r.progress as number | null) ?? null,
      updatedAt: (r.updated_at as string | null) ?? null,
      username: p?.name,
      skinPath: p?.skin ?? null,
    };
  });
}

/** Display name of a room's host (for invites from outside the room). Null when unknown. */
export async function getRoomHostName(hostId: string): Promise<string | null> {
  const { data } = await supabase
    .from(TABLE.profiles)
    .select("username, nick")
    .eq("id", hostId)
    .maybeSingle();
  const name = ((data?.username as string | undefined) || (data?.nick as string | undefined) || "").trim();
  return name || null;
}

/**
 * Publish my own party state (RLS: own row only; trigger keeps role/ids fixed).
 * Callers throttle progress writes; pass progress only while installing.
 */
export async function setMyMemberState(
  roomId: string,
  userId: string,
  state: PartyMemberState,
  progress: number | null = null,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE.voiceRoomMembers)
    .update({
      state,
      progress: state === "installing" ? progress : null,
      updated_at: new Date().toISOString(),
    })
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.savePartyState"));
}
