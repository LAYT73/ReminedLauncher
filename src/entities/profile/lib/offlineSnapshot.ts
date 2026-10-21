import { call } from "@/shared/api/invoke";
import { cacheAccount, readOfflineCache } from "@/entities/session";
import { mediaSrc, resolveMediaFromDisk, warmMediaCache } from "@/shared/lib/mediaCache";
import { isSkinUrl, normalizeSkinModel, type SkinModelKind } from "@/entities/skin";
import { CMD } from "@/shared/config/commands";

async function resolveDataUrl(
  path: string | null | undefined,
  offline: boolean,
  previous: string | null | undefined,
): Promise<string | null> {
  let data = previous ?? null;
  if (!path) return data;
  if (!offline) {
    try {
      if (isSkinUrl(path)) {
        await warmMediaCache([path]);
        data = mediaSrc(path) ?? data;
        await call<string>(CMD.materializeSkinPath, { skin: path }).catch(
          () => "",
        );
      } else {
        data = await call<string | null>(CMD.readSkinDataUrl, { path });
      }
    } catch {
      /* keep previous */
    }
  } else if (isSkinUrl(path)) {
    await resolveMediaFromDisk([path]);
    data = mediaSrc(path) ?? data;
  }
  return data;
}

/**
 * Cache the signed-in account (incl. skin/cape as data URLs) so the launcher
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
  capePath?: string | null;
  skinModel?: SkinModelKind | null;
}) {
  const prev = readOfflineCache().account;
  const skinData = await resolveDataUrl(
    opts.skinPath,
    opts.offline,
    prev?.skin_data_url,
  );
  const capeData = await resolveDataUrl(
    opts.capePath ?? null,
    opts.offline,
    prev?.cape_data_url,
  );
  cacheAccount({
    userId: opts.userId,
    email: opts.email ?? null,
    remined_id: opts.reminedId,
    username: opts.username,
    skin_path: opts.skinPath,
    cape_path: opts.capePath ?? null,
    skin_model: normalizeSkinModel(
      opts.skinModel ?? prev?.skin_model,
    ),
    skin_data_url: skinData,
    cape_data_url: capeData,
  });
}
