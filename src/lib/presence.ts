import { supabase, supabaseConfigured } from "./supabase";

export type PresenceStatus = "offline" | "online" | "in_game" | "hosting";

/** Heartbeat older than this → treat as offline when listing friends. */
export const PRESENCE_STALE_MS = 90_000;

export async function setPresence(opts: {
  userId: string;
  status: PresenceStatus;
  packId?: string | null;
  shareCode?: string | null;
  gamePort?: number | null;
}): Promise<void> {
  if (!supabaseConfigured) return;
  const hosting = opts.status === "hosting";
  const playing = opts.status === "in_game" || hosting;
  const row: Record<string, unknown> = {
    user_id: opts.userId,
    status: opts.status,
    pack_id: playing ? (opts.packId?.trim() || null) : null,
    share_code: hosting ? (opts.shareCode?.trim() || null) : null,
    game_port: hosting && opts.gamePort && opts.gamePort > 0 ? opts.gamePort : null,
    // Clear legacy ZeroTier fields so old clients don't try a dead path
    zt_ip: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("sessions").upsert(row, {
    onConflict: "user_id",
  });
  if (error) {
    console.warn("[presence]", error.message);
  }
}

export function isPresenceFresh(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < PRESENCE_STALE_MS;
}
