import { useMemo } from "react";
import { localizeCatalog } from "@/shared/lib/mediaCache";
import { isReminePackId } from "@/shared/lib/packIds";
import { useProfileStore } from "@/entities/profile";
import { usePackStore } from "./store";
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
  return useMemo(() => pickSelectedPack(packs, selectedId), [packs, selectedId]);
}

export function useReminePacks(): Pack[] {
  const packs = usePackStore((s) => s.packs);
  return useMemo(() => pickReminePacks(packs), [packs]);
}

export function useActiveReminePack(): Pack | undefined {
  const packs = usePackStore((s) => s.packs);
  const selectedId = useProfileStore((s) => s.profile.selected_pack);
  return useMemo(() => pickActiveReminePack(packs, selectedId), [packs, selectedId]);
}

export function useInstalledPacks(): Pack[] {
  const packs = usePackStore((s) => s.packs);
  const installed = usePackStore((s) => s.installedIds);
  return useMemo(() => packs.filter((p) => installed.has(p.id)), [packs, installed]);
}

/** Catalog with media URLs swapped for the on-disk cache. */
export function useViewCatalog() {
  const catalog = usePackStore((s) => s.catalog);
  const mediaTick = usePackStore((s) => s.mediaTick);
  // mediaTick forces re-localize after disk/network hydrate
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => localizeCatalog(catalog), [catalog, mediaTick]);
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
