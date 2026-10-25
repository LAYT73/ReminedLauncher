import { useVersionStore } from "@/entities/game-version";
import { localizePack, usePackStore, type Pack } from "@/entities/pack";
import { getLocale, t } from "@/shared/i18n";
import {
  isReminedVanillaPackId,
  isVanillaPackId,
  reminedVanillaPackId,
  vanillaPackId,
  versionFromPackId,
} from "@/shared/lib/packIds";

/** A pack a party can run, as the host's picker shows it. */
export type PartyPackOption = { id: string; name: string; version: string };

/** Display name of a pack id: catalog name, or the edition label for Vanilla / Remined Vanilla. */
export function partyPackLabel(packId: string): string {
  if (isVanillaPackId(packId)) {
    return t("voice.party.vanillaPack", { v: versionFromPackId(packId) });
  }
  if (isReminedVanillaPackId(packId)) {
    return t("voice.party.reminedVanillaPack", { v: versionFromPackId(packId) });
  }
  const pack = usePackStore.getState().packs.find((p) => p.id === packId);
  return pack ? localizePack(pack, getLocale()).name : packId;
}

/**
 * Packs the host can pick for the party: the Remined catalog, every Vanilla or
 * Remined Vanilla version that is installed, the host's current edition picks,
 * and the party's current pack (so it is always listed).
 */
export function partyPackOptions(reminePacks: Pack[], currentPackId: string | null): PartyPackOption[] {
  const { packs, installedIds } = usePackStore.getState();
  const picks = useVersionStore.getState().by;
  const out: PartyPackOption[] = reminePacks.map((p) => ({ id: p.id, name: p.name, version: p.version }));
  const seen = new Set(out.map((o) => o.id));
  const add = (id: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const installed = installedIds.has(id);
    out.push({
      id,
      name: partyPackLabel(id),
      version: installed ? t("pack.select.installed") : "",
    });
  };
  for (const p of packs) {
    if ((isVanillaPackId(p.id) || isReminedVanillaPackId(p.id)) && installedIds.has(p.id)) {
      add(p.id);
    }
  }
  add(vanillaPackId(picks.vanilla.pick ?? ""));
  add(reminedVanillaPackId(picks["remined-vanilla"].pick ?? ""));
  if (currentPackId) add(currentPackId);
  return out;
}

/** "{name} invites you to a party" (+ " · {pack}" when the pack is known). */
export function partyInviteText(name: string, packId: string | null | undefined): string {
  const base = t("voice.invitedYou", { name });
  return packId ? `${base} · ${partyPackLabel(packId)}` : base;
}
