import { applyTheme } from "@/entities/theme";
import { useVersionStore } from "@/entities/game-version";
import { useGameStore, gameApi } from "@/entities/game";
import { setStatus } from "@/entities/install";
import {
  normalizeProfile,
  profileApi,
  useProfileStore,
} from "@/entities/profile";
import { readOfflineCache, useSessionStore } from "@/entities/session";
import { FALLBACK_APP_VERSION } from "@/shared/config/limits";
import { TIMING } from "@/shared/config/timings";
import { readLastPlayed, writeLastPlayed } from "@/shared/lib/lastPlayed";
import {
  collectCatalogMediaUrls,
  resolveMediaFromDisk,
  warmMediaCache,
} from "@/shared/lib/mediaCache";
import { withTimeout } from "@/shared/lib/network";
import { isReminePackId, isVanillaPackId, versionFromPackId } from "@/shared/lib/packIds";
import {
  fetchCatalogFromSupabase,
  pickDefaultPack,
  type CatalogPack,
} from "../api/catalog";
import { packApi } from "../api/pack-api";
import { usePackStore } from "./store";
import type { Pack } from "./types";

/** Re-download (or just re-resolve) catalog images, then re-localize URLs. */
export async function hydratePackMedia(
  catalog: CatalogPack[],
  download: boolean,
): Promise<void> {
  const urls = collectCatalogMediaUrls(catalog);
  if (download) await warmMediaCache(urls);
  else await resolveMediaFromDisk(urls);
  usePackStore.getState().bumpMedia();
}

/** Catalog ∪ local installs, so a lone vanilla install can't hide Remined packs. */
function mergePacks(catalog: CatalogPack[], local: Pack[]): Pack[] {
  const byId = new Map<string, Pack>();
  for (const c of catalog) {
    byId.set(c.id, {
      id: c.id,
      name: c.name,
      version: c.version ?? "—",
      description: c.blurb,
    });
  }
  for (const p of local) {
    const meta = catalog.find((c) => c.id === p.id);
    byId.set(p.id, {
      ...p,
      name: meta?.name || p.name,
      description: meta?.blurb || p.description,
    });
  }
  return Array.from(byId.values());
}

/** Which Remined pack the Java rail should select by default. */
function defaultJavaPackId(merged: Pack[], catalog: CatalogPack[]): string {
  const lastJava = readLastPlayed().java;
  const def = pickDefaultPack(catalog);
  const remine = merged.filter((p) => isReminePackId(p.id));
  const remembered =
    lastJava && remine.some((p) => p.id === lastJava) ? lastJava : null;
  const first = remembered ?? remine[0]?.id ?? def?.id ?? "";
  if (lastJava && first === lastJava) return lastJava;
  return def?.id ?? first;
}

/**
 * Load packs, profile, game phase and the catalog into the stores. Safe to call
 * repeatedly (after installs / reconnects).
 */
export async function bootstrapLauncher(): Promise<void> {
  const offline = useSessionStore.getState().offlineMode;
  try {
    // Offline / flaky net: never wait on Supabase/GitHub catalog forever.
    const catalogPromise = offline
      ? Promise.resolve(readOfflineCache().catalog)
      : withTimeout(fetchCatalogFromSupabase(), TIMING.catalogFetch, () =>
          readOfflineCache().catalog,
        );

    const [packList, saved, gamePhase, version, catalog] = await Promise.all([
      packApi.list(),
      profileApi.get(),
      gameApi.phase(),
      profileApi.appVersion(),
      catalogPromise,
    ]);
    const next = normalizeProfile(saved);
    const packs = usePackStore.getState();
    packs.setCatalog(catalog);

    const merged = mergePacks(catalog, packList);
    packs.setPacks(merged);

    if (!next.selected_pack || isVanillaPackId(next.selected_pack)) {
      if (next.selected_pack) {
        const ver =
          packList.find((p) => p.id === next.selected_pack)?.version ??
          versionFromPackId(next.selected_pack);
        useVersionStore.getState().patch("vanilla", { pick: ver });
        writeLastPlayed({ vanilla: ver });
      }
      next.selected_pack = defaultJavaPackId(merged, catalog);
    }

    // Also probe selected / catalog packs for install state.
    const ids = new Set(packList.map((p) => p.id));
    await Promise.all(
      merged.map(async (p) => {
        try {
          if ((await packApi.status(p.id)).installed) ids.add(p.id);
        } catch {
          /* ignore */
        }
      }),
    );
    packs.setInstalledIds(ids);

    const profile = useProfileStore.getState();
    profile.setProfile(next);
    applyTheme(next.theme);
    useGameStore.getState().setPhase(gamePhase);
    profile.setAppVersion(version || FALLBACK_APP_VERSION);
    void profile.refreshJava(next.java_path);
    void hydratePackMedia(catalog, !offline);
    // Skin preview comes from syncCloudProfile (per-account Supabase).
  } catch (err) {
    setStatus(String(err), "error");
  }
}
