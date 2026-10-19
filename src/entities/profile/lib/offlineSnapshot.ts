import { call } from "@/shared/api/invoke";
import { cacheAccount, readOfflineCache } from "@/entities/session";
import { mediaSrc, resolveMediaFromDisk, warmMediaCache } from "@/shared/lib/mediaCache";
import { isSkinUrl, normalizeSkinModel, type SkinModelKind } from "@/entities/skin";
import { CMD } from "@/shared/config/commands";

/**
 * Cache the signed-in account (incl. the skin as a data URL) so the launcher
 * can start offline next time.
 */
export async function rememberOfflineSnapshot(opts: {
  /** True while the launcher is in offline mode (no network fetches). */
  offline: boolean;
  userId: string;
  email?: string | null;
  reminedId: string | null;
  username: string;
  skinPath: string | null;
  skinModel?: SkinModelKind | null;
}) {
  let skinData: string | null =
    readOfflineCache().account?.skin_data_url ?? null;
  if (opts.skinPath && !opts.offline) {
    try {
      if (isSkinUrl(opts.skinPath)) {
        await warmMediaCache([opts.skinPath]);
        skinData = mediaSrc(opts.skinPath) ?? skinData;
        // Also keep launch materialization warm
        await call<string>(CMD.materializeSkinPath, {
          skin: opts.skinPath,
        }).catch(() => "");
      } else {
        skinData = await call<string | null>(CMD.readSkinDataUrl, {
          path: opts.skinPath,
        });
      }
    } catch {
      /* keep previous cache */
    }
  } else if (opts.skinPath && isSkinUrl(opts.skinPath)) {
    await resolveMediaFromDisk([opts.skinPath]);
    skinData = mediaSrc(opts.skinPath) ?? skinData;
  }
  cacheAccount({
    userId: opts.userId,
    email: opts.email ?? null,
    remined_id: opts.reminedId,
    username: opts.username,
    skin_path: opts.skinPath,
    skin_model: normalizeSkinModel(
      opts.skinModel ?? readOfflineCache().account?.skin_model,
    ),
    skin_data_url: skinData,
  });
}

