import { localizeServerError } from "@/shared/lib/errors";
import { supabase } from "@/shared/api/supabase";
import { TABLE } from "@/shared/config/supabase";
import type { VoiceMember, VoiceMemberRole } from "../model/types";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { t } from "@/shared/i18n";

export async function listRoomMembers(roomId: string): Promise<VoiceMember[]> {
  const { data, error } = await supabase
    .from(TABLE.voiceRoomMembers)
    .select("user_id, role, joined_at")
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
      username: p?.name,
      skinPath: p?.skin ?? null,
    };
  });
}
