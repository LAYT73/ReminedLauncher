import { MSG } from "@/shared/config/messages";
import { isCancelledError } from "@/shared/lib/errors";
import { isBrowserOnline } from "@/shared/lib/network";
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
  install.begin(MSG.install.updatingPack);
  try {
    await packApi.ensure(packId);
    await bootstrapLauncher();
    setStatus(MSG.install.packReady, "ok");
  } catch (err) {
    setStatus(String(err), "error");
  } finally {
    install.setPackSyncing(false);
    install.end();
  }
}

/** Download / update the active Remined pack. */
export async function downloadPack(): Promise<void> {
  const pack = getActiveReminePack();
  if (!pack || getPlayState().busy) return;
  const install = useInstallStore.getState();
  install.begin(MSG.install.preparing);
  try {
    await packApi.ensure(pack.id);
    usePackStore.getState().markInstalled(pack.id);
    await bootstrapLauncher();
    setStatus(MSG.install.readyToPlay, "ok");
  } catch (err) {
    if (isCancelledError(err)) setStatus(MSG.install.cancelled);
    else setStatus(String(err), "error");
  } finally {
    install.end();
  }
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
    await downloadPack();
    return (await packApi.status(pack.id)).installed;
  } catch (err) {
    setStatus(String(err), "error");
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
