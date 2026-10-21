import type { CatalogPack } from "@/entities/pack";
import { normalizeSkinModel, type SkinModelKind } from "@/entities/skin";
import { STORAGE_KEY } from "@/shared/config/storage-keys";

const KEY = STORAGE_KEY.offlineCache;

export type OfflineAccount = {
  userId: string;
  email: string | null;
  remined_id: string | null;
  username: string;
  skin_path: string | null;
  cape_path?: string | null;
  skin_model?: SkinModelKind;
  /** Local data-URL fallback when CDN is unreachable. */
  skin_data_url: string | null;
  cape_data_url?: string | null;
};

export type OfflineCache = {
  saved_at: string;
  account: OfflineAccount | null;
  catalog: CatalogPack[];
  onboarding_completed: boolean;
};

function empty(): OfflineCache {
  return {
    saved_at: new Date(0).toISOString(),
    account: null,
    catalog: [],
    onboarding_completed: false,
  };
}

export function readOfflineCache(): OfflineCache {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<OfflineCache>;
    return {
      saved_at: typeof parsed.saved_at === "string" ? parsed.saved_at : empty().saved_at,
      account: parsed.account && typeof parsed.account === "object" ? parsed.account : null,
      catalog: Array.isArray(parsed.catalog) ? (parsed.catalog as CatalogPack[]) : [],
      onboarding_completed: Boolean(parsed.onboarding_completed),
    };
  } catch {
    return empty();
  }
}

export function writeOfflineCache(next: OfflineCache): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...next, saved_at: new Date().toISOString() }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function patchOfflineCache(patch: Partial<OfflineCache>): OfflineCache {
  const cur = readOfflineCache();
  const next: OfflineCache = {
    ...cur,
    ...patch,
    account: patch.account === undefined ? cur.account : patch.account,
    catalog: patch.catalog ?? cur.catalog,
  };
  writeOfflineCache(next);
  return next;
}

export function cacheCatalog(catalog: CatalogPack[]): void {
  if (catalog.length === 0) return;
  patchOfflineCache({ catalog });
}

export function cacheAccount(account: OfflineAccount): void {
  patchOfflineCache({
    account: {
      ...account,
      skin_model: normalizeSkinModel(account.skin_model),
    },
  });
}

export function cacheOnboardingCompleted(done: boolean): void {
  patchOfflineCache({ onboarding_completed: done });
}

export function clearOfflineAccount(): void {
  patchOfflineCache({ account: null });
}

export function canEnterOffline(cache = readOfflineCache()): boolean {
  return Boolean(
    cache.onboarding_completed &&
      cache.account?.userId &&
      (cache.account.username.trim() || cache.account.remined_id),
  );
}
