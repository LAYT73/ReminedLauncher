import { MSG } from "@/shared/config/messages";
import { isCancelledError } from "@/shared/lib/errors";
import { readLastPlayed } from "@/shared/lib/lastPlayed";
import { isBrowserOnline } from "@/shared/lib/network";
import { toast } from "@/shared/lib/toast";
import {
  EDITIONS,
  getEditionState,
  useVersionStore,
  versionApi,
  type Edition,
  type VersionList,
} from "@/entities/game-version";
import { setStatus, useInstallStore } from "@/entities/install";
import { bootstrapLauncher, usePackStore } from "@/entities/pack";
import { useSessionStore } from "@/entities/session";

const isOffline = () =>
  useSessionStore.getState().offlineMode || !isBrowserOnline();

function fallbackPick(edition: Edition, list: VersionList): string {
  return (
    list.versions.find(EDITIONS[edition].isPreferredInstalled)?.id ?? list.latest
  );
}

/** Fetch the version manifest and settle the pick (no-op once loaded). */
export async function loadVersions(edition: Edition, force = false): Promise<void> {
  const { patch } = useVersionStore.getState();
  const state = getEditionState(edition);
  if (state.busy || (state.loaded && !force)) return;

  if (isOffline()) {
    if (!state.pick) {
      const local = usePackStore
        .getState()
        .packs.find((p) => EDITIONS[edition].isPackId(p.id));
      if (local) patch(edition, { pick: local.version });
    }
    return;
  }

  patch(edition, { busy: true });
  try {
    const list = await versionApi.list(edition);
    patch(edition, { versions: list.versions, loaded: true });
    const { pick } = getEditionState(edition);
    const has = (id: string | undefined) =>
      Boolean(id && list.versions.some((v) => v.id === id));
    if (!pick) {
      const remembered = readLastPlayed()[edition];
      patch(edition, {
        pick: has(remembered) ? remembered! : fallbackPick(edition, list),
      });
    } else if (!has(pick)) {
      patch(edition, { pick: fallbackPick(edition, list) });
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  } finally {
    patch(edition, { busy: false });
  }
}

/** Install a version of an edition. Returns true when it is ready to play. */
export async function installVersion(
  edition: Edition,
  versionId: string,
): Promise<boolean> {
  if (!versionId) return false;
  if (isOffline()) {
    toast(MSG.offline.install);
    return false;
  }
  const { patch, select, setInstalled } = useVersionStore.getState();
  const install = useInstallStore.getState();
  patch(edition, { busy: true });
  install.begin(EDITIONS[edition].installMessage(versionId));
  try {
    const st = await versionApi.install(edition, versionId);
    usePackStore.getState().markInstalled(st.id);
    select(edition, versionId);
    await bootstrapLauncher();
    setInstalled(edition, versionId, true);
    setStatus(MSG.install.readyToPlay, "ok");
    return true;
  } catch (err) {
    if (isCancelledError(err)) setStatus(MSG.install.cancelled);
    else setStatus(String(err), "error");
    return false;
  } finally {
    patch(edition, { busy: false });
    install.end();
  }
}
