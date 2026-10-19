import { supabase, supabaseConfigured } from "@/shared/api/supabase";
import { TABLE } from "@/shared/config/supabase";
import type { PlayStats } from "@/shared/lib/playtime";

let lastRpcError: string | null = null;

export function lastPlaytimeError(): string | null {
  return lastRpcError;
}

function rowToStats(row: {
  playtime_seconds?: number | null;
  last_played_at?: string | null;
}): PlayStats {
  return {
    playtimeSeconds: Math.max(0, Number(row.playtime_seconds) || 0),
    lastPlayedAt: row.last_played_at ?? null,
  };
}

/** Load all pack playtime rows for the signed-in user. */
export async function fetchMyPackPlaytimes(): Promise<
  Record<string, PlayStats>
> {
  if (!supabaseConfigured) return {};
  const { data, error } = await supabase
    .from(TABLE.packPlaytime)
    .select("pack_id, playtime_seconds, last_played_at");
  if (error) {
    lastRpcError = error.message;
    console.warn("[playtime] fetch", error.message);
    return {};
  }
  lastRpcError = null;
  const out: Record<string, PlayStats> = {};
  for (const r of data ?? []) {
    const id = String((r as { pack_id?: string }).pack_id ?? "").trim();
    if (!id) continue;
    out[id] = rowToStats(
      r as { playtime_seconds?: number; last_played_at?: string },
    );
  }
  return out;
}

/**
 * Add playtime for one pack (0 = only touch last_played_at).
 * Requires migration 012. Never permanently disables retries.
 */
export async function recordPackPlaySession(
  packId: string,
  seconds: number,
): Promise<(PlayStats & { packId: string }) | null> {
  const id = packId.trim();
  if (!id || !supabaseConfigured) return null;
  const secs = Math.max(0, Math.min(Math.floor(seconds), 604_800));

  const { data, error } = await supabase.rpc("record_pack_play_session", {
    p_pack_id: id,
    p_seconds: secs,
  });
  if (error) {
    lastRpcError = error.message;
    console.warn("[playtime] rpc", error.message);
    // Fallback: direct upsert if RPC missing / schema cache stale.
    return upsertPackPlaytime(id, secs);
  }
  lastRpcError = null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    // RPC returned empty — still try upsert so UI can move.
    return upsertPackPlaytime(id, secs);
  }
  const r = row as {
    pack_id?: string;
    playtime_seconds?: number;
    last_played_at?: string;
  };
  return {
    packId: (r.pack_id ?? id).trim(),
    ...rowToStats(r),
  };
}

async function upsertPackPlaytime(
  packId: string,
  addSeconds: number,
): Promise<(PlayStats & { packId: string }) | null> {
  const {
    data: auth,
  } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;

  const { data: existing } = await supabase
    .from(TABLE.packPlaytime)
    .select("playtime_seconds, last_played_at")
    .eq("user_id", uid)
    .eq("pack_id", packId)
    .maybeSingle();

  const prev = Math.max(0, Number(existing?.playtime_seconds) || 0);
  const nextSec = prev + addSeconds;
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from(TABLE.packPlaytime)
    .upsert(
      {
        user_id: uid,
        pack_id: packId,
        playtime_seconds: nextSec,
        last_played_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,pack_id" },
    )
    .select("pack_id, playtime_seconds, last_played_at")
    .single();

  if (error) {
    lastRpcError = error.message;
    console.warn("[playtime] upsert", error.message);
    return null;
  }
  lastRpcError = null;
  return {
    packId,
    ...rowToStats(data as { playtime_seconds?: number; last_played_at?: string }),
  };
}
