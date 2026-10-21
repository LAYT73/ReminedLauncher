import type { Session } from "@supabase/supabase-js";
import { usePlaytimeStore } from "@/entities/playtime";
import { useSkinStore, normalizeSkinModel } from "@/entities/skin";
import {
  canEnterOffline,
  readOfflineCache,
  useSessionStore,
} from "@/entities/session";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { ensureCloudProfile } from "../api/cloudProfile";
import { profileApi } from "../api/profile-api";
import { rememberOfflineSnapshot } from "../lib/offlineSnapshot";
import { normalizeProfile } from "../lib/profile";
import type { Profile } from "./types";
import { useProfileStore } from "./store";

/** Local `profile.json`, normalised. */
export async function loadLocalProfile(): Promise<Profile> {
  return normalizeProfile(await profileApi.get());
}

/**
 * Pull the account-bound fields (username, skin, model) from Supabase into the
 * local profile. Falls back to the offline cache when the cloud is unreachable.
 * Returns the profile that should be used for launching.
 */
export async function syncCloudProfile(nextSession: Session): Promise<Profile> {
  const session = useSessionStore.getState();
  const profileStore = useProfileStore.getState();
  const skin = useSkinStore.getState();
  const local = await loadLocalProfile();
  try {
    const cloud = await ensureCloudProfile(nextSession.user.id);
    session.setReminedId(cloud.remined_id);
    void usePlaytimeStore.getState().refresh();

    // Local profile.json is shared across accounts — always overwrite
    // account-bound fields from Supabase (null skin = Remined default Steve).
    const next: Profile = {
      ...local,
      username: cloud.username.trim() || FALLBACK_USERNAME,
      skin_path: cloud.skin_path ?? null,
      cape_path: cloud.cape_path ?? null,
      skin_model: cloud.skin_model,
    };

    await profileStore.persist(next);
    await skin.applyPreview(cloud.skin_path);
    await skin.applyCapePreview(cloud.cape_path);
    profileStore.setUsernameDraft(null);
    void rememberOfflineSnapshot({
      offline: useSessionStore.getState().offlineMode,
      userId: nextSession.user.id,
      email: nextSession.user.email ?? null,
      reminedId: cloud.remined_id,
      username: next.username,
      skinPath: next.skin_path,
      capePath: next.cape_path,
      skinModel: next.skin_model,
    });
    return next;
  } catch (err) {
    console.warn("cloud profile", err);
    const cached = readOfflineCache().account;
    if (cached?.skin_data_url) skin.setPreview(cached.skin_data_url);
    else if (cached?.skin_path) await skin.applyPreview(cached.skin_path);
    else skin.setPreview(null);
    if (cached?.cape_data_url) skin.setCapePreview(cached.cape_data_url);
    else if (cached?.cape_path) await skin.applyCapePreview(cached.cape_path);
    else skin.setCapePreview(null);
    if (cached?.remined_id) session.setReminedId(cached.remined_id);
    return local;
  }
}

/** Adopt the cached account as the current profile (offline entry). */
export async function applyOfflineAccount(): Promise<boolean> {
  const cache = readOfflineCache();
  if (!canEnterOffline(cache)) return false;
  const acct = cache.account!;
  useSessionStore.getState().setReminedId(acct.remined_id);
  const local = await loadLocalProfile();
  const next: Profile = {
    ...local,
    username: acct.username.trim() || local.username || FALLBACK_USERNAME,
    skin_path: acct.skin_path ?? local.skin_path,
    cape_path: acct.cape_path ?? local.cape_path,
    skin_model: normalizeSkinModel(acct.skin_model ?? local.skin_model),
  };
  await useProfileStore.getState().persist(next);
  const skin = useSkinStore.getState();
  if (acct.skin_data_url) skin.setPreview(acct.skin_data_url);
  else await skin.applyPreview(next.skin_path);
  if (acct.cape_data_url) skin.setCapePreview(acct.cape_data_url);
  else await skin.applyCapePreview(next.cape_path);
  return true;
}
