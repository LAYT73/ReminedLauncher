import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";
import { MSG } from "@/shared/config/messages";
import { isBrowserOnline } from "@/shared/lib/network";
import { toast } from "@/shared/lib/toast";
import { setStatus } from "@/entities/install";
import { useSessionStore } from "@/entities/session";

export type PendingLauncherUpdate = {
  version: string;
  notes: string | null;
  /** Live updater handle — kept until install or dismiss. */
  update: Update;
};

type UpdateState = {
  busy: boolean;
  pending: PendingLauncherUpdate | null;
  /** Check only — does not download until the user confirms. */
  checkForUpdate: () => Promise<void>;
  /** Download + install the pending build, then restart. */
  installPending: () => Promise<void>;
  dismissPending: () => void;
};

export const useLauncherUpdate = create<UpdateState>((set, get) => ({
  busy: false,
  pending: null,

  dismissPending: () => {
    const pending = get().pending;
    if (pending) {
      void pending.update.close().catch(() => undefined);
    }
    set({ pending: null });
  },

  checkForUpdate: async () => {
    if (useSessionStore.getState().offlineMode || !isBrowserOnline()) {
      toast(MSG.offline.updateCheck);
      return;
    }
    // Drop a previous pending handle before a fresh check.
    get().dismissPending();
    set({ busy: true });
    setStatus(MSG.update.checking);
    try {
      const update = await check();
      if (!update) {
        setStatus(MSG.update.latest, "ok");
        toast(MSG.update.latest, "ok");
        return;
      }
      const pending: PendingLauncherUpdate = {
        version: update.version,
        notes: update.body?.trim() || null,
        update,
      };
      set({ pending });
      setStatus(MSG.update.available(update.version), "ok");
      toast(MSG.update.available(update.version), "ok");
    } catch (err) {
      setStatus(String(err), "error");
    } finally {
      set({ busy: false });
    }
  },

  installPending: async () => {
    const pending = get().pending;
    if (!pending || get().busy) return;
    if (useSessionStore.getState().offlineMode || !isBrowserOnline()) {
      toast(MSG.offline.updateCheck);
      return;
    }
    set({ busy: true });
    setStatus(MSG.update.downloading(pending.version));
    try {
      await pending.update.downloadAndInstall();
      set({ pending: null });
      setStatus(MSG.update.restarting);
      await relaunch();
    } catch (err) {
      setStatus(String(err), "error");
    } finally {
      set({ busy: false });
    }
  },
}));
