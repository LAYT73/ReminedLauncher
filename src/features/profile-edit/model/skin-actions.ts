import { t } from "@/shared/i18n";
import { open } from "@tauri-apps/plugin-dialog";
import { MSG } from "@/shared/config/messages";
import { errorMessage } from "@/shared/lib/errors";
import { toast } from "@/shared/lib/toast";
import {
  invalidateMedia,
  seedMedia,
  warmMediaCache,
} from "@/shared/lib/mediaCache";
import {
  clearAccountCape,
  clearAccountSkin,
  ensureCloudProfile,
  publishAccountCape,
  publishAccountSkin,
  rememberOfflineSnapshot,
  updateCloudSkinModel,
  useProfileStore,
} from "@/entities/profile";
import {
  cacheAccount,
  readOfflineCache,
  useSessionStore,
} from "@/entities/session";
import {
  isSkinUrl,
  normalizeSkinModel,
  skinApi,
  useSkinStore,
  type SkinModelKind,
} from "@/entities/skin";

/** Pick a PNG, upload it to the account and apply it as the current skin. */
export async function pickSkin(): Promise<boolean> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!selected || Array.isArray(selected)) return false;

  const session = useSessionStore.getState();
  if (session.offlineMode) {
    toast(MSG.offline.skinSync);
    return false;
  }
  const user = session.session?.user;
  if (!user?.id) {
    toast(MSG.offline.signInForSkin);
    return false;
  }

  const skin = useSkinStore.getState();
  const { profile, persist } = useProfileStore.getState();

  // Local bytes are authoritative — same CDN URL is reused on replace.
  const dataUrl = await skinApi.readDataUrl(selected);
  if (!dataUrl) {
    toast(t("profile.errors.readSkin"));
    return false;
  }
  skin.setPreview(dataUrl);

  try {
    let id = session.reminedId;
    if (!id) {
      id = (await ensureCloudProfile(user.id)).remined_id;
      session.setReminedId(id);
    }
    const url = await publishAccountSkin(id, selected, user.id);
    const next = { ...profile, skin_path: url };
    await persist(next);

    invalidateMedia([url]);
    seedMedia(url, dataUrl);
    skin.setPreview(dataUrl);

    // Refresh disk cache in the background; re-seed after so a stale CDN
    // response cannot overwrite the just-uploaded bytes in the media map.
    void warmMediaCache([url]).then(() => {
      seedMedia(url, dataUrl);
    });

    void rememberOfflineSnapshot({
      offline: useSessionStore.getState().offlineMode,
      userId: user.id,
      email: user.email ?? null,
      reminedId: id,
      username: next.username,
      skinPath: url,
      capePath: next.cape_path,
      skinModel: next.skin_model,
    });
    toast(MSG.profile.skinSaved);
    return true;
  } catch (err) {
    skin.setPreview(
      profile.skin_path && isSkinUrl(profile.skin_path) ? profile.skin_path : null,
    );
    toast(errorMessage(err, ""));
    return false;
  }
}

export async function clearSkin(): Promise<void> {
  const { profile, persist } = useProfileStore.getState();
  await persist({ ...profile, skin_path: null });
  useSkinStore.getState().setPreview(null);
  const { session, reminedId } = useSessionStore.getState();
  if (session?.user?.id && reminedId) {
    try {
      await clearAccountSkin(reminedId, session.user.id);
    } catch {
      /* ignore */
    }
  }
}

/** Pick a PNG cape, upload it, show in 3D preview. */
export async function pickCape(): Promise<boolean> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!selected || Array.isArray(selected)) return false;

  const session = useSessionStore.getState();
  if (session.offlineMode) {
    toast(MSG.offline.skinSync);
    return false;
  }
  const user = session.session?.user;
  if (!user?.id) {
    toast(MSG.offline.signInForSkin);
    return false;
  }

  const skin = useSkinStore.getState();
  const { profile, persist } = useProfileStore.getState();

  const dataUrl = await skinApi.readDataUrl(selected);
  if (!dataUrl) {
    toast(t("profile.errors.readCape"));
    return false;
  }
  skin.setCapePreview(dataUrl);

  try {
    let id = session.reminedId;
    if (!id) {
      id = (await ensureCloudProfile(user.id)).remined_id;
      session.setReminedId(id);
    }
    const url = await publishAccountCape(id, selected, user.id);
    const next = { ...profile, cape_path: url };
    await persist(next);

    invalidateMedia([url]);
    seedMedia(url, dataUrl);
    skin.setCapePreview(dataUrl);
    void warmMediaCache([url]).then(() => {
      seedMedia(url, dataUrl);
    });

    void rememberOfflineSnapshot({
      offline: useSessionStore.getState().offlineMode,
      userId: user.id,
      email: user.email ?? null,
      reminedId: id,
      username: next.username,
      skinPath: next.skin_path,
      capePath: url,
      skinModel: next.skin_model,
    });
    toast(MSG.profile.capeSaved);
    return true;
  } catch (err) {
    skin.setCapePreview(
      profile.cape_path && isSkinUrl(profile.cape_path)
        ? profile.cape_path
        : null,
    );
    toast(errorMessage(err, ""));
    return false;
  }
}

export async function clearCape(): Promise<void> {
  const { profile, persist } = useProfileStore.getState();
  await persist({ ...profile, cape_path: null });
  useSkinStore.getState().setCapePreview(null);
  const { session, reminedId } = useSessionStore.getState();
  if (session?.user?.id && reminedId) {
    try {
      await clearAccountCape(reminedId, session.user.id);
    } catch {
      /* ignore */
    }
  }
}

export async function setSkinModel(model: SkinModelKind): Promise<void> {
  const nextModel = normalizeSkinModel(model);
  const { profile, persist } = useProfileStore.getState();
  if (nextModel === profile.skin_model) return;
  const next = { ...profile, skin_model: nextModel };
  await persist(next);

  const { offlineMode, session, reminedId } = useSessionStore.getState();
  if (offlineMode) {
    const acct = readOfflineCache().account;
    if (acct) cacheAccount({ ...acct, skin_model: nextModel });
    return;
  }
  if (!session?.user?.id) return;
  try {
    const saved = await updateCloudSkinModel(session.user.id, nextModel);
    if (saved !== nextModel) await persist({ ...next, skin_model: saved });
    void rememberOfflineSnapshot({
      offline: useSessionStore.getState().offlineMode,
      userId: session.user.id,
      email: session.user.email ?? null,
      reminedId,
      username: next.username,
      skinPath: next.skin_path,
      capePath: next.cape_path,
      skinModel: saved,
    });
  } catch (err) {
    toast(errorMessage(err, ""));
  }
}
