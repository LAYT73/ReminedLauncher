import { localizeServerError } from "@/shared/lib/errors";
import { supabase } from "@/shared/api/supabase";
import type { CloudProfile } from "@/entities/profile";
import { findProfileByReminedId, normalizeReminedId } from "@/entities/profile";
import {
  isPresenceFresh,
  markActivityColumnMissing,
  markVoiceColumnMissing,
  sessionsHaveActivityColumn,
  sessionsHaveVoiceColumn,
} from "@/entities/session";
import { normalizeSkinModel } from "@/entities/skin";
import { TABLE } from "@/shared/config/supabase";
import { t } from "@/shared/i18n";

export type FriendshipStatus = "pending" | "accepted" | "blocked";

export type FriendRow = {
  friendshipId: string;
  status: FriendshipStatus;
  direction: "incoming" | "outgoing" | "friend";
  profile: CloudProfile;
  sessionStatus?: string | null;
  sessionPackId?: string | null;
  sessionPackName?: string | null;
  sessionShareCode?: string | null;
  sessionGamePort?: number | null;
  sessionInVoice?: boolean;
  /** Friend-safe activity code from `sessions.activity` (null on old servers/clients). */
  sessionActivity?: string | null;
  /** ISO timestamp from `sessions.updated_at` (last presence heartbeat). */
  sessionUpdatedAt?: string | null;
};

type FriendshipRecord = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
};

export function canJoinFriend(row: FriendRow): boolean {
  return (
    row.direction === "friend" &&
    row.sessionStatus === "hosting" &&
    Boolean(row.sessionShareCode?.trim()) &&
    typeof row.sessionGamePort === "number" &&
    row.sessionGamePort > 0 &&
    Boolean(row.sessionPackId?.trim())
  );
}

/** Fresh hosting share code + LAN port from Supabase (Friends UI can be stale). */
export async function fetchFriendHosting(
  hostUserId: string,
): Promise<{
  packId: string;
  shareCode: string;
  gamePort: number;
} | null> {
  const { data, error } = await supabase
    .from(TABLE.sessions)
    .select("status, pack_id, share_code, game_port, updated_at")
    .eq("user_id", hostUserId)
    .maybeSingle();
  if (error || !data) return null;
  const updatedAt = (data.updated_at as string | null) ?? null;
  if ((data.status as string) !== "hosting" || !isPresenceFresh(updatedAt)) {
    return null;
  }
  const packId = ((data.pack_id as string | null) ?? "").trim();
  const shareCode = ((data.share_code as string | null) ?? "").trim();
  const gamePortRaw = data.game_port as number | null;
  const gamePort =
    typeof gamePortRaw === "number" && gamePortRaw > 0 ? gamePortRaw : 0;
  if (!packId || !shareCode || !gamePort) return null;
  return { packId, shareCode, gamePort };
}

export async function listFriendships(userId: string): Promise<FriendRow[]> {
  const { data: rows, error } = await supabase
    .from(TABLE.friendships)
    .select("id, requester_id, addressee_id, status")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .neq("status", "blocked");
  if (error) throw new Error(localizeServerError(error.message) || t("social.errors.loadFriends"));
  const list = (rows ?? []) as FriendshipRecord[];
  if (list.length === 0) return [];

  const otherIds = list.map((r) =>
    r.requester_id === userId ? r.addressee_id : r.requester_id,
  );
  const { data: profiles, error: pErr } = await supabase
    .from(TABLE.profiles)
    .select("id, nick, username, skin_path, cape_path, skin_model")
    .in("id", otherIds);
  if (pErr) throw new Error(localizeServerError(pErr.message) || t("social.errors.loadProfiles"));

  const baseCols = "user_id, status, pack_id, share_code, game_port, updated_at";
  let sessions: Record<string, unknown>[] | null = null;
  // Optional columns (migrations 010 / 017) may be missing: drop and retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    const cols = [
      baseCols,
      sessionsHaveVoiceColumn() ? "in_voice" : "",
      sessionsHaveActivityColumn() ? "activity" : "",
    ]
      .filter(Boolean)
      .join(", ");
    const r = await supabase
      .from(TABLE.sessions)
      .select(cols)
      .in("user_id", otherIds);
    if (r.error) {
      if (sessionsHaveVoiceColumn() && /in_voice/i.test(r.error.message)) {
        markVoiceColumnMissing();
        continue;
      }
      if (sessionsHaveActivityColumn() && /activity/i.test(r.error.message)) {
        markActivityColumnMissing();
        continue;
      }
      break;
    }
    sessions = r.data as unknown as Record<string, unknown>[] | null;
    break;
  }

  type SessionRow = {
    status: string;
    packId: string | null;
    shareCode: string | null;
    gamePort: number | null;
    updatedAt: string | null;
    inVoice: boolean;
    activity: string | null;
  };
  const sessionBy = new Map<string, SessionRow>();
  const packIds = new Set<string>();
  for (const s of sessions ?? []) {
    const uid = s.user_id as string;
    const packId = ((s.pack_id as string | null) ?? "").trim() || null;
    const updatedAt = (s.updated_at as string | null) ?? null;
    const rawStatus = (s.status as string) || "offline";
    const status =
      rawStatus === "offline" || !isPresenceFresh(updatedAt)
        ? "offline"
        : rawStatus;
    const shareCode = ((s.share_code as string | null) ?? "").trim() || null;
    const gamePortRaw = s.game_port as number | null;
    const gamePort =
      typeof gamePortRaw === "number" && gamePortRaw > 0 ? gamePortRaw : null;
    sessionBy.set(uid, {
      status,
      packId: status === "offline" ? null : packId,
      shareCode: status === "hosting" ? shareCode : null,
      gamePort: status === "hosting" ? gamePort : null,
      updatedAt,
      inVoice: status !== "offline" && Boolean(s.in_voice),
      activity:
        status === "in_game" || status === "hosting"
          ? ((s.activity as string | null) ?? "").trim() || null
          : null,
    });
    if (status !== "offline" && packId) packIds.add(packId);
  }

  const packNameBy = new Map<string, string>();
  if (packIds.size > 0) {
    const { data: packRows } = await supabase
      .from(TABLE.packs)
      .select("id, name")
      .in("id", [...packIds]);
    for (const p of packRows ?? []) {
      packNameBy.set(p.id as string, (p.name as string) || (p.id as string));
    }
  }

  const byId = new Map(
    (profiles ?? []).map((p) => {
      const remined_id = ((p.nick as string | null) ?? "").toLowerCase();
      const rawUser = (p.username as string | null)?.trim() || "";
      const profile: CloudProfile = {
        id: p.id as string,
        remined_id,
        username: rawUser || `user${remined_id || String(p.id).slice(0, 7)}`,
        skin_path: (p.skin_path as string | null) ?? null,
        cape_path: (p.cape_path as string | null) ?? null,
        skin_model: normalizeSkinModel(p.skin_model as string | null),
      };
      return [profile.id, profile] as const;
    }),
  );

  const out: FriendRow[] = [];
  for (const r of list) {
    const otherId = r.requester_id === userId ? r.addressee_id : r.requester_id;
    const profile = byId.get(otherId);
    if (!profile) continue;
    let direction: FriendRow["direction"] = "friend";
    if (r.status === "pending") {
      direction = r.addressee_id === userId ? "incoming" : "outgoing";
    }
    const sess = sessionBy.get(otherId);
    const sessionStatus = sess?.status ?? "offline";
    const sessionPackId = sess?.packId ?? null;
    out.push({
      friendshipId: r.id,
      status: r.status,
      direction,
      profile,
      sessionStatus,
      sessionPackId,
      sessionPackName: sessionPackId
        ? (packNameBy.get(sessionPackId) ?? sessionPackId)
        : null,
      sessionShareCode: sess?.shareCode ?? null,
      sessionGamePort: sess?.gamePort ?? null,
      sessionInVoice: sess?.inVoice ?? false,
      sessionActivity: sess?.activity ?? null,
      sessionUpdatedAt: sess?.updatedAt ?? null,
    });
  }

  out.sort((a, b) => {
    const rank = (d: FriendRow["direction"]) =>
      d === "incoming" ? 0 : d === "friend" ? 1 : 2;
    return rank(a.direction) - rank(b.direction);
  });
  return out;
}

export async function sendFriendRequest(
  myUserId: string,
  rawReminedId: string,
): Promise<void> {
  const target = await findProfileByReminedId(rawReminedId);
  if (!target) throw new Error(t("social.errors.nobodyWithId"));
  if (target.id === myUserId) throw new Error(t("social.errors.thatsYou"));

  const { error } = await supabase.from(TABLE.friendships).insert({
    requester_id: myUserId,
    addressee_id: target.id,
    status: "pending",
  });
  if (error) {
    if (error.code === "23505") {
      throw new Error(t("social.errors.alreadySent"));
    }
    throw new Error(localizeServerError(error.message) || t("social.errors.sendRequest"));
  }
}

export async function respondFriendRequest(
  friendshipId: string,
  accept: boolean,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE.friendships)
    .update({
      status: accept ? "accepted" : "blocked",
      updated_at: new Date().toISOString(),
    })
    .eq("id", friendshipId);
  if (error) throw new Error(localizeServerError(error.message) || t("social.errors.updateRequest"));
}

export async function removeFriendship(friendshipId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE.friendships)
    .delete()
    .eq("id", friendshipId);
  if (error) throw new Error(localizeServerError(error.message) || t("social.errors.removeFriend"));
}

export { normalizeReminedId };
