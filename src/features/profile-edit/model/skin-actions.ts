import { open } from "@tauri-apps/plugin-dialog";
import { MSG } from "@/shared/config/messages";
import { toast } from "@/shared/lib/toast";
import { warmMediaCache } from "@/shared/lib/mediaCache";
import {
  clearAccountSkin,
  ensureCloudProfile,
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

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** Pick a PNG, upload it to the account and apply it as the current skin. */
export async function pickSkin(): Promise<void> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!selected || Array.isArray(selected)) return;

  const session = useSessionStore.getState();
  if (session.offlineMode) {
    toast(MSG.offline.skinSync);
    return;
  }
  const user = session.session?.user;
  if (!user?.id) {
    toast(MSG.offline.signInForSkin);
    return;
  }

  const skin = useSkinStore.getState();
  const { profile, persist } = useProfileStore.getState();

  // Local preview while uploading.
  skin.setPreview(await skinApi.readDataUrl(selected));

  try {
    let id = session.reminedId;
    if (!id) {
      id = (await ensureCloudProfile(user.id)).remined_id;
      session.setReminedId(id);
    }
    const url = await publishAccountSkin(id, selected, user.id);
    const next = { ...profile, skin_path: url };
    await persist(next);
    await warmMediaCache([url]);
    await skin.applyPreview(url);
    void rememberOfflineSnapshot({
      offline: useSessionStore.getState().offlineMode,
      userId: user.id,
      email: user.email ?? null,
      reminedId: id,
      username: next.username,
      skinPath: url,
      skinModel: next.skin_model,
    });
    toast(MSG.profile.skinSaved);
  } catch (err) {
    skin.setPreview(
      profile.skin_path && isSkinUrl(profile.skin_path) ? profile.skin_path : null,
    );
    toast(errorMessage(err));
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
      skinModel: saved,
    });
  } catch (err) {
    toast(errorMessage(err));
  }
}
