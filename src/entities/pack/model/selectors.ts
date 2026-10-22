import { useMemo } from "react";
import { useLocale } from "@/shared/i18n";
import { localizeCatalog } from "@/shared/lib/mediaCache";
import { isReminePackId } from "@/shared/lib/packIds";
import { useProfileStore } from "@/entities/profile";
import { usePackStore } from "./store";
import { localizePack } from "../lib/localize";
import type { Pack } from "./types";

/** Pure derivations (shared by hooks and imperative actions). */
export const pickSelectedPack = (packs: Pack[], selectedId: string) =>
  packs.find((p) => p.id === selectedId) ?? packs[0];

export const pickReminePacks = (packs: Pack[]) =>
  packs.filter((p) => isReminePackId(p.id));

/** Remined catalog pack for rail logo / pack page — never a vanilla edition. */
export function pickActiveReminePack(
  packs: Pack[],
  selectedId: string,
): Pack | undefined {
  const selected = pickSelectedPack(packs, selectedId);
  if (selected && isReminePackId(selected.id)) return selected;
  return pickReminePacks(packs)[0];
}

export function useSelectedPack(): Pack | undefined {
  const packs = usePackStore((s) => s.packs);
  const selectedId = useProfileStore((s) => s.profile.selected_pack);
  const locale = useLocale();
  return useMemo(() => {
    const p = pickSelectedPack(packs, selectedId);
    return p ? localizePack(p, locale) : p;
  }, [packs, selectedId, locale]);
}

export function useReminePacks(): Pack[] {
  const packs = usePackStore((s) => s.packs);
  const locale = useLocale();
  return useMemo(
    () => pickReminePacks(packs).map((p) => localizePack(p, locale)),
    [packs, locale],
  );
}

export function useActiveReminePack(): Pack | undefined {
  const packs = usePackStore((s) => s.packs);
  const selectedId = useProfileStore((s) => s.profile.selected_pack);
  const locale = useLocale();
  return useMemo(() => {
    const p = pickActiveReminePack(packs, selectedId);
    return p ? localizePack(p, locale) : p;
  }, [packs, selectedId, locale]);
}

export function useInstalledPacks(): Pack[] {
  const packs = usePackStore((s) => s.packs);
  const installed = usePackStore((s) => s.installedIds);
  const locale = useLocale();
  return useMemo(
    () => packs.filter((p) => installed.has(p.id)).map((p) => localizePack(p, locale)),
    [packs, installed, locale],
  );
}

/** Catalog with media URLs swapped for the on-disk cache. */
export function useViewCatalog() {
  const catalog = usePackStore((s) => s.catalog);
  const mediaTick = usePackStore((s) => s.mediaTick);
  // mediaTick forces re-localize after disk/network hydrate
  const locale = useLocale();
  return useMemo(
    () => localizeCatalog(catalog).map((c) => localizePack(c, locale)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, mediaTick, locale],
  );
}

export function usePackContent(packId: string | undefined) {
  const view = useViewCatalog();
  return useMemo(
    () => (packId ? view.find((c) => c.id === packId) : undefined),
    [view, packId],
  );
}

/** Imperative: active Remined pack right now. */
export function getActiveReminePack(): Pack | undefined {
  return pickActiveReminePack(
    usePackStore.getState().packs,
    useProfileStore.getState().profile.selected_pack,
  );
}

export function getSelectedPack(): Pack | undefined {
  return pickSelectedPack(
    usePackStore.getState().packs,
    useProfileStore.getState().profile.selected_pack,
  );
}
