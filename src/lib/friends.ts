import { supabase } from "./supabase";
import type { CloudProfile } from "./cloudProfile";
import { findProfileByReminedId, normalizeReminedId } from "./cloudProfile";
import { isPresenceFresh } from "./presence";

export type FriendshipStatus = "pending" | "accepted" | "blocked";

export type FriendRow = {
  friendshipId: string;
  status: FriendshipStatus;
  direction: "incoming" | "outgoing" | "friend";
  profile: CloudProfile;
  sessionStatus?: string | null;
  sessionPackId?: string | null;
  sessionPackName?: string | null;
};

type FriendshipRecord = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
};

export async function listFriendships(userId: string): Promise<FriendRow[]> {
  const { data: rows, error } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .neq("status", "blocked");
  if (error) throw new Error(error.message || "Could not load friends");
  const list = (rows ?? []) as FriendshipRecord[];
  if (list.length === 0) return [];

  const otherIds = list.map((r) =>
    r.requester_id === userId ? r.addressee_id : r.requester_id,
  );
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, nick, username, skin_path")
    .in("id", otherIds);
  if (pErr) throw new Error(pErr.message || "Could not load profiles");

  const { data: sessions } = await supabase
    .from("sessions")
    .select("user_id, status, pack_id, updated_at")
    .in("user_id", otherIds);

  type SessionRow = {
    status: string;
    packId: string | null;
    updatedAt: string | null;
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
    sessionBy.set(uid, {
      status,
      packId: status === "offline" ? null : packId,
      updatedAt,
    });
    if (status !== "offline" && packId) packIds.add(packId);
  }

  const packNameBy = new Map<string, string>();
  if (packIds.size > 0) {
    const { data: packRows } = await supabase
      .from("packs")
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
  if (!target) throw new Error("Nobody with that Remined id");
  if (target.id === myUserId) throw new Error("That’s you");

  const { error } = await supabase.from("friendships").insert({
    requester_id: myUserId,
    addressee_id: target.id,
    status: "pending",
  });
  if (error) {
    if (error.code === "23505") {
      throw new Error("Already sent or already friends");
    }
    throw new Error(error.message || "Could not send request");
  }
}

export async function respondFriendRequest(
  friendshipId: string,
  accept: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("friendships")
    .update({
      status: accept ? "accepted" : "blocked",
      updated_at: new Date().toISOString(),
    })
    .eq("id", friendshipId);
  if (error) throw new Error(error.message || "Could not update request");
}

export async function removeFriendship(friendshipId: string): Promise<void> {
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("id", friendshipId);
  if (error) throw new Error(error.message || "Could not remove friend");
}

export { normalizeReminedId };
