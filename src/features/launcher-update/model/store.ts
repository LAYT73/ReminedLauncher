import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";
import { MSG } from "@/shared/config/messages";
import { isBrowserOnline } from "@/shared/lib/network";
import { toast } from "@/shared/lib/toast";
import { setStatus } from "@/entities/install";
import { useSessionStore } from "@/entities/session";

type UpdateState = {
  busy: boolean;
  /** Download + install a new launcher build and restart. */
  checkForUpdate: () => Promise<void>;
};

export const useLauncherUpdate = create<UpdateState>((set) => ({
  busy: false,
  checkForUpdate: async () => {
    if (useSessionStore.getState().offlineMode || !isBrowserOnline()) {
      toast(MSG.offline.updateCheck);
      return;
    }
    set({ busy: true });
    setStatus(MSG.update.checking);
    try {
      const update = await check();
      if (!update) {
        setStatus(MSG.update.latest, "ok");
        return;
      }
      setStatus(MSG.update.downloading(update.version));
      await update.downloadAndInstall();
      setStatus(MSG.update.restarting);
      await relaunch();
    } catch (err) {
      setStatus(String(err), "error");
    } finally {
      set({ busy: false });
    }
  },
}));
