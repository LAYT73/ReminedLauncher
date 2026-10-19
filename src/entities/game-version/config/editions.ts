import { CMD, type Command } from "@/shared/config/commands";
import { MSG } from "@/shared/config/messages";
import {
  isReminedVanillaPackId,
  isVanillaPackId,
  reminedVanillaPackId,
  vanillaPackId,
} from "@/shared/lib/packIds";
import type {
  Edition,
  PackOption,
  VanillaVersionRow,
  VersionList,
} from "../model/types";

type EditionConfig = {
  listCommand: Command;
  installCommand: Command;
  parseList: (raw: never) => VersionList;
  /** Which version to prefer when it is already installed. */
  isPreferredInstalled: (v: VanillaVersionRow) => boolean;
  /** Matches installed packs of this edition. */
  isPackId: (packId: string) => boolean;
  packId: (version: string) => string;
  installMessage: (versionId: string) => string;
  /** Rows listed in the playbar select (from the manifest). */
  selectable: (v: VanillaVersionRow) => boolean;
  /** Hint under a version in the select. */
  hint: (v: VanillaVersionRow) => string;
};

export const EDITIONS: Record<Edition, EditionConfig> = {
  vanilla: {
    listCommand: CMD.listVanillaVersions,
    installCommand: CMD.installVanillaVersion,
    parseList: (res: {
      latest: { release: string };
      versions: VanillaVersionRow[];
    }) => ({ versions: res.versions, latest: res.latest.release }),
    isPreferredInstalled: (v) => v.installed && v.type === "release",
    isPackId: isVanillaPackId,
    packId: vanillaPackId,
    installMessage: MSG.install.installingVersion,
    selectable: (v) => v.type === "release",
    hint: (v) => (v.installed ? "Installed" : "Release"),
  },
  "remined-vanilla": {
    listCommand: CMD.listReminedVanillaVersions,
    installCommand: CMD.installReminedVanillaVersion,
    parseList: (res: { latest: string; versions: VanillaVersionRow[] }) => ({
      versions: res.versions,
      latest: res.latest,
    }),
    isPreferredInstalled: (v) => v.installed,
    isPackId: isReminedVanillaPackId,
    packId: reminedVanillaPackId,
    installMessage: MSG.install.installingReminedVanilla,
    selectable: () => true,
    hint: (v) => (v.installed ? "Installed" : "Fabric + skins"),
  },
};

export const EDITION_IDS = Object.keys(EDITIONS) as Edition[];

/** Select options for an edition; falls back to installed packs when the list is empty. */
export function editionOptions(
  edition: Edition,
  versions: VanillaVersionRow[],
  packs: { id: string; version: string }[],
): PackOption[] {
  const cfg = EDITIONS[edition];
  const fromManifest = versions
    .filter(cfg.selectable)
    .map((v) => ({ id: v.id, name: v.id, version: cfg.hint(v) }));
  if (fromManifest.length > 0) return fromManifest;
  return packs
    .filter((p) => cfg.isPackId(p.id))
    .map((p) => ({ id: p.version, name: p.version, version: "Installed" }));
}
