import { confirm } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { MSG } from "@/shared/config/messages";
import { RAIL, routeFor } from "@/shared/config/routes";
import { writeLastPlayed } from "@/shared/lib/lastPlayed";
import { navigateTo } from "@/shared/lib/navigator";
import {
  isReminedVanillaPackId,
  isReminePackId,
  isVanillaPackId,
  versionFromPackId,
} from "@/shared/lib/packIds";
import { toast } from "@/shared/lib/toast";
import { useGameStore } from "@/entities/game";
import { useVersionStore, type Edition } from "@/entities/game-version";
import { setStatus } from "@/entities/install";
import {
  bootstrapLauncher,
  packApi,
  usePackStore,
  type Pack,
} from "@/entities/pack";
import { useProfileStore } from "@/entities/profile";

const editionOf = (packId: string): Edition | null =>
  isVanillaPackId(packId)
    ? "vanilla"
    : isReminedVanillaPackId(packId)
      ? "remined-vanilla"
      : null;

/** Pack to select when the selected one was deleted. */
function fallbackSelection(deletedId: string): string {
  const { packs, catalog } = usePackStore.getState();
  return (
    packs.find((p) => p.id !== deletedId && !isVanillaPackId(p.id))?.id ??
    catalog.find((c) => c.id !== deletedId)?.id ??
    packs.find((p) => p.id !== deletedId && isReminePackId(p.id))?.id ??
    ""
  );
}

/** Remove an installation from disk and repair every selection that pointed at it. */
export async function deleteInstalledPack(packId: string): Promise<void> {
  // window.confirm is non-blocking in Tauri/WKWebView — use the plugin dialog.
  const ok = await confirm(MSG.install.deleteConfirm(packId), {
    title: MSG.install.deleteTitle,
    kind: "warning",
    okLabel: MSG.install.deleteOk,
    cancelLabel: MSG.install.deleteCancel,
  });
  if (!ok) return;
  setStatus(MSG.install.deletingPack);
  try {
    await packApi.remove(packId);
    usePackStore.getState().markRemoved(packId);

    const edition = editionOf(packId);
    if (edition) {
      const versions = useVersionStore.getState();
      const ver = versionFromPackId(packId);
      versions.setInstalled(edition, ver, false);
      if (versions.by[edition].pick === ver) versions.patch(edition, { pick: "" });
    }

    const { profile, persist } = useProfileStore.getState();
    if (profile.selected_pack === packId) {
      await persist({
        ...profile,
        selected_pack: fallbackSelection(packId),
      });
    }
    const game = useGameStore.getState();
    if (game.runningPackId === packId) game.setRunningPackId(null);
    await bootstrapLauncher();
    setStatus(MSG.install.packDeleted, "ok");
    toast(MSG.install.installationRemoved);
  } catch (err) {
    setStatus(String(err), "error");
  }
}

/** Click on a row in Installations: select that pack on its rail. */
export function selectInstalledPack(pack: Pack): void {
  const edition = editionOf(pack.id);
  if (edition) {
    useVersionStore.getState().select(edition, pack.version);
    navigateTo(routeFor(edition === "vanilla" ? RAIL.vanilla : RAIL.reminedVanilla));
    return;
  }
  writeLastPlayed({ java: pack.id });
  const { profile, persist } = useProfileStore.getState();
  void persist({ ...profile, selected_pack: pack.id });
  navigateTo(routeFor(RAIL.java));
}

export async function revealPackFolder(packId: string): Promise<void> {
  try {
    await packApi.openFolder(packId);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
}

/** Open a crash report in the OS file manager. */
export function revealPath(path: string): void {
  void revealItemInDir(path).catch(() => undefined);
}
