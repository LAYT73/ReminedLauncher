import { supabase } from "@/shared/api/supabase";
import {
  normalizeSkinModel,
  type SkinModelKind,
} from "@/entities/skin";
import { BUCKET, TABLE } from "@/shared/config/supabase";
import { MSG } from "@/shared/config/messages";

export type CloudProfile = {
  id: string;
  remined_id: string;
  username: string;
  skin_path: string | null;
  skin_model: SkinModelKind;
};

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export function generateReminedId(): string {
  const bytes = new Uint8Array(7);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 7; i++) {
    out += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  }
  return out;
}

export function normalizeReminedId(raw: string): string {
  return raw.trim().replace(/^#/, "").toLowerCase();
}

export function normalizeUsername(raw: string): string {
  return raw.trim();
}

export function validateUsername(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (!USERNAME_RE.test(u)) {
    return "3–16 letters, numbers, or _";
  }
  return null;
}

/** Visible name: username, or user{remined_id} edge-case fallback. */
export function displayUsername(p: {
  username?: string | null;
  remined_id?: string | null;
  id?: string;
}): string {
  const u = (p.username ?? "").trim();
  if (u) return u;
  const id =
    (p.remined_id ?? "").trim() || (p.id ?? "").replace(/-/g, "").slice(0, 7);
  return `user${id}`;
}

export function skinPublicUrl(reminedId: string, cacheBust = false): string {
  const id = reminedId.toLowerCase();
  const base = `${supabase.storage.from(BUCKET.skins).getPublicUrl(`${id}.png`).data.publicUrl}`;
  return cacheBust ? `${base}?t=${Date.now()}` : base;
}

type ProfileRow = {
  id: string;
  nick: string | null;
  username: string | null;
  skin_path: string | null;
  skin_model?: string | null;
};

function asCloud(row: ProfileRow): CloudProfile {
  const remined_id = (row.nick ?? "").toLowerCase();
  return {
    id: row.id,
    remined_id,
    username: displayUsername({
      username: row.username,
      remined_id,
      id: row.id,
    }),
    skin_path: row.skin_path,
    skin_model: normalizeSkinModel(row.skin_model),
  };
}

function asRow(data: unknown): ProfileRow {
  return data as ProfileRow;
}

const SELECT = "id, nick, username, skin_path, skin_model";

async function allocateReminedId(
  userId: string,
  row: ProfileRow | null,
): Promise<ProfileRow> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const remined_id = generateReminedId();
    if (row) {
      const { data, error } = await supabase
        .from(TABLE.profiles)
        .update({
          nick: remined_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .select(SELECT)
        .single();
      if (!error && data) return asRow(data);
    } else {
      const { data, error } = await supabase
        .from(TABLE.profiles)
        .insert({ id: userId, nick: remined_id })
        .select(SELECT)
        .single();
      if (!error && data) return asRow(data);
      const { data: again } = await supabase
        .from(TABLE.profiles)
        .select(SELECT)
        .eq("id", userId)
        .maybeSingle();
      if (again) {
        row = asRow(again);
        if (row.nick && /^[a-z0-9]{7}$/i.test(row.nick)) return row;
      }
    }
  }
  throw new Error("Could not allocate Remined id");
}

/**
 * Remined id → profiles.nick (7 chars).
 * Account username → profiles.username (unique).
 */
export async function ensureCloudProfile(
  userId: string,
  preferredUsername?: string | null,
): Promise<CloudProfile> {
  const { data: existing, error } = await supabase
    .from(TABLE.profiles)
    .select(SELECT)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  let row = existing ? asRow(existing) : null;
  if (!row?.nick || !/^[a-z0-9]{7}$/i.test(row.nick)) {
    row = await allocateReminedId(userId, row);
  }

  const preferred = preferredUsername
    ? normalizeUsername(preferredUsername)
    : null;

  if (!row.username) {
    const fallback = preferred || `user${row.nick!.toLowerCase()}`;
    const { data, error: updErr } = await supabase
      .from(TABLE.profiles)
      .update({
        username: fallback,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select(SELECT)
      .single();
    if (!updErr && data) return asCloud(asRow(data));
    if (preferred && preferred !== `user${row.nick!.toLowerCase()}`) {
      const { data: data2, error: err2 } = await supabase
        .from(TABLE.profiles)
        .update({
          username: `user${row.nick!.toLowerCase()}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .select(SELECT)
        .single();
      if (!err2 && data2) return asCloud(asRow(data2));
    }
  }

  return asCloud(row);
}


function escapeIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function isUsernameAvailable(
  username: string,
  exceptUserId?: string,
): Promise<boolean> {
  const u = normalizeUsername(username);
  const { data, error } = await supabase
    .from(TABLE.profiles)
    .select("id")
    .ilike("username", escapeIlike(u))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return true;
  return exceptUserId != null && data.id === exceptUserId;
}

export async function updateCloudUsername(
  userId: string,
  username: string,
): Promise<string> {
  const err = validateUsername(username);
  if (err) throw new Error(err);
  const u = normalizeUsername(username);

  const available = await isUsernameAvailable(u, userId);
  if (!available) {
    throw new Error(MSG.auth.usernameTaken);
  }

  const { data, error } = await supabase
    .from(TABLE.profiles)
    .update({
      username: u,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select(SELECT)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(MSG.auth.usernameTaken);
    }
    throw new Error(error.message);
  }
  return asCloud(asRow(data)).username;
}

export async function findProfileByReminedId(
  rawId: string,
): Promise<CloudProfile | null> {
  const remined_id = normalizeReminedId(rawId);
  if (remined_id.length !== 7) return null;
  const { data, error } = await supabase
    .from(TABLE.profiles)
    .select(SELECT)
    .eq("nick", remined_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? asCloud(asRow(data)) : null;
}

export async function updateCloudSkinUrl(
  userId: string,
  skinUrl: string | null,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE.profiles)
    .update({
      skin_path: skinUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

export async function updateCloudSkinModel(
  userId: string,
  model: SkinModelKind,
): Promise<SkinModelKind> {
  const skin_model = normalizeSkinModel(model);
  const { data, error } = await supabase
    .from(TABLE.profiles)
    .update({
      skin_model,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return asCloud(asRow(data)).skin_model;
}
