import { localizeServerError } from "@/shared/lib/errors";
import { supabase } from "@/shared/api/supabase";
import { TABLE } from "@/shared/config/supabase";
import type { VoiceMessage } from "../model/types";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { t } from "@/shared/i18n";

export async function listMessages(roomId: string, limit = 80): Promise<VoiceMessage[]> {
  const { data, error } = await supabase
    .from(TABLE.voiceMessages)
    .select("id, room_id, sender_id, body, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.loadMessages"));
  // Newest `limit` rows (so long chats keep the tail), shown oldest-first.
  const rows = (data ?? []).slice().reverse();
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.sender_id as string))];
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
  if (!body) throw new Error(t("voice.errors.emptyMessage"));
  const { data, error } = await supabase
    .from(TABLE.voiceMessages)
    .insert({
      room_id: opts.roomId,
      sender_id: opts.senderId,
      body: body.slice(0, 2000),
    })
    .select("id, room_id, sender_id, body, created_at")
    .single();
  if (error) throw new Error(localizeServerError(error.message) || t("voice.errors.sendMessage"));
  return {
    id: data.id as string,
    roomId: data.room_id as string,
    senderId: data.sender_id as string,
    body: data.body as string,
    createdAt: data.created_at as string,
  };
}
