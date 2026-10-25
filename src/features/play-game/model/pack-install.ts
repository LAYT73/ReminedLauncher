import { t } from "@/shared/i18n";
import { MSG } from "@/shared/config/messages";
import { errorMessage, isCancelledError } from "@/shared/lib/errors";
import { isBrowserOnline } from "@/shared/lib/network";
import { notifySystem } from "@/shared/lib/systemNotify";
import { toast } from "@/shared/lib/toast";
import { setStatus, useInstallStore } from "@/entities/install";
import {
  bootstrapLauncher,
  getActiveReminePack,
  packApi,
  usePackStore,
} from "@/entities/pack";
import { useSessionStore } from "@/entities/session";
import { getPlayState } from "./play-state";

/** Settings → "Sync pack": re-run `ensure_pack` for the active Remined pack. */
export async function syncPack(): Promise<void> {
  if (useSessionStore.getState().offlineMode || !isBrowserOnline()) {
    toast(MSG.offline.packUpdates);
    return;
  }
  const packId = getActiveReminePack()?.id;
  if (!packId) return;
  const install = useInstallStore.getState();
  install.setPackSyncing(true);
  install.begin(MSG.install.updatingPack, packId);
  try {
    await packApi.ensure(packId);
    await bootstrapLauncher();
    setStatus(MSG.install.packReady, "ok");
  } catch (err) {
    setStatus(errorMessage(err), "error");
  } finally {
    install.setPackSyncing(false);
    install.end();
  }
}

/** Ensure, mark and bootstrap the active pack. No busy guard: callers decide. True on success. */
async function installActivePack(): Promise<boolean> {
  const pack = getActiveReminePack();
  if (!pack) return false;
  const install = useInstallStore.getState();
  install.begin(MSG.install.preparing, pack.id);
  try {
    await packApi.ensure(pack.id);
    usePackStore.getState().markInstalled(pack.id);
    await bootstrapLauncher();
    setStatus(MSG.install.readyToPlay, "ok");
    void notifySystem(
      t("shell.notify.packReady.title"),
      t("shell.notify.packReady.body", { name: pack.name }),
    );
    return true;
  } catch (err) {
    if (isCancelledError(err)) setStatus(MSG.install.cancelled);
    else setStatus(errorMessage(err), "error");
    return false;
  } finally {
    install.end();
  }
}

/** Download / update the active Remined pack. */
export async function downloadPack(): Promise<void> {
  if (!getActiveReminePack() || getPlayState().busy) return;
  await installActivePack();
}

/** Make sure the active Remined pack matches the latest release. */
export async function ensurePackUpToDate(): Promise<boolean> {
  const pack = getActiveReminePack();
  if (!pack) return false;
  setStatus(MSG.install.checkingPackUpdate);
  try {
    const [remote, local] = await Promise.all([
      packApi.latestRelease(pack.id),
      packApi.status(pack.id),
    ]);
    if (local.installed && local.local_version === remote.version) return true;
    setStatus(
      local.installed
        ? MSG.install.updatingTo(remote.version)
        : MSG.install.downloading(remote.version),
    );
    // A cancelled/failed update must not launch the stale pack.
    return await installActivePack();
  } catch (err) {
    setStatus(errorMessage(err), "error");
    return false;
  }
}

export async function cancelCurrentInstall(): Promise<void> {
  if (!useInstallStore.getState().installing) return;
  try {
    await packApi.cancelInstall();
  } catch {
    /* ignore */
  }
}
