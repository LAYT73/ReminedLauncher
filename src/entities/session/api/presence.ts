import { supabase, supabaseConfigured } from "@/shared/api/supabase";
import { TABLE } from "@/shared/config/supabase";

export type PresenceStatus = "offline" | "online" | "in_game" | "hosting";

/** Heartbeat older than this → treat as offline when listing friends. */
export const PRESENCE_STALE_MS = 90_000;

/** Set once the server tells us `in_voice` doesn't exist (migration 010 not applied). */
let voiceColumnMissing = false;
export function sessionsHaveVoiceColumn(): boolean {
  return !voiceColumnMissing;
}
export function markVoiceColumnMissing() {
  voiceColumnMissing = true;
}

/** Set once the server tells us `activity` doesn't exist (migration 017 not applied). */
let activityColumnMissing = false;
export function sessionsHaveActivityColumn(): boolean {
  return !activityColumnMissing;
}
export function markActivityColumnMissing() {
  activityColumnMissing = true;
}

export async function setPresence(opts: {
  userId: string;
  status: PresenceStatus;
  packId?: string | null;
  shareCode?: string | null;
  gamePort?: number | null;
  inVoice?: boolean;
  /** Friend-safe activity code (see migration 017); null when not playing. */
  activity?: string | null;
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
  if (!activityColumnMissing) row.activity = playing ? opts.activity || null : null;
  if (!voiceColumnMissing) row.in_voice = Boolean(opts.inVoice);
  let { error } = await supabase.from(TABLE.sessions).upsert(row, {
    onConflict: "user_id",
  });
  if (error && !activityColumnMissing && /activity/i.test(error.message)) {
    activityColumnMissing = true;
    delete row.activity;
    ({ error } = await supabase.from(TABLE.sessions).upsert(row, {
      onConflict: "user_id",
    }));
  }
  if (error && !voiceColumnMissing && /in_voice/i.test(error.message)) {
    voiceColumnMissing = true;
    delete row.in_voice;
    ({ error } = await supabase.from(TABLE.sessions).upsert(row, {
      onConflict: "user_id",
    }));
  }
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
