import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";
import { MSG } from "@/shared/config/messages";
import { t } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/errors";
import { isBrowserOnline } from "@/shared/lib/network";
import { notifySystem } from "@/shared/lib/systemNotify";
import { toast } from "@/shared/lib/toast";
import { setStatus } from "@/entities/install";
import { useSessionStore } from "@/entities/session";

/**
 * When true, the startup update modal opens with sample content so you can
 * judge the UI without a real release. Set to `false` before shipping.
 */
export const FORCE_UPDATE_MODAL = false;

export type PendingLauncherUpdate = {
  version: string;
  notes: string | null;
  /** Live updater handle — null when previewing with FORCE_UPDATE_MODAL. */
  update: Update | null;
};

type CheckOpts = {
  /** No toasts / status spam — used on launcher startup. */
  silent?: boolean;
};

type UpdateState = {
  busy: boolean;
  pending: PendingLauncherUpdate | null;
  /** Startup (or forced) modal visibility. */
  promptOpen: boolean;
  /** Check only — does not download until the user confirms. */
  checkForUpdate: (opts?: CheckOpts) => Promise<void>;
  /** Download + install the pending build, then restart. */
  installPending: () => Promise<void>;
  dismissPending: () => void;
  /** Hide the modal; keep pending so Settings can still install. */
  closePrompt: () => void;
  /** Open the forced preview modal (visual QA). */
  openForcePrompt: () => void;
};

export const useLauncherUpdate = create<UpdateState>((set, get) => ({
  busy: false,
  pending: null,
  promptOpen: false,

  closePrompt: () => set({ promptOpen: false }),

  openForcePrompt: () => {
    set({
      pending: {
        version: "1.2.0",
        notes:
          "• Faster voice lobby\n• Relay tunnel polish\n• Bug fixes and stability",
        update: null,
      },
      promptOpen: true,
    });
  },

  dismissPending: () => {
    const pending = get().pending;
    if (pending?.update) {
      void pending.update.close().catch(() => undefined);
    }
    set({ pending: null, promptOpen: false });
  },

  checkForUpdate: async (opts) => {
    const silent = Boolean(opts?.silent);
    if (useSessionStore.getState().offlineMode || !isBrowserOnline()) {
      if (!silent) toast(MSG.offline.updateCheck);
      return;
    }
    // Drop a previous pending handle before a fresh check.
    get().dismissPending();
    set({ busy: true });
    if (!silent) setStatus(MSG.update.checking);
    try {
      const update = await check();
      if (!update) {
        if (!silent) {
          setStatus(MSG.update.latest, "ok");
          toast(MSG.update.latest, "ok");
        }
        return;
      }
      const pending: PendingLauncherUpdate = {
        version: update.version,
        notes: update.body?.trim() || null,
        update,
      };
      set({ pending, promptOpen: true });
      void notifySystem(
        t("shell.notify.launcherUpdate.title"),
        t("shell.notify.launcherUpdate.body", { v: update.version }),
      );
      if (!silent) {
        setStatus(MSG.update.available(update.version), "ok");
        toast(MSG.update.available(update.version), "ok");
      }
    } catch (err) {
      if (!silent) setStatus(errorMessage(err), "error");
    } finally {
      set({ busy: false });
    }
  },

  installPending: async () => {
    const pending = get().pending;
    if (!pending || get().busy) return;
    if (!pending.update) {
      toast(t("settings.update.modal.previewOnly"), "err");
      return;
    }
    if (useSessionStore.getState().offlineMode || !isBrowserOnline()) {
      toast(MSG.offline.updateCheck);
      return;
    }
    set({ busy: true });
    setStatus(MSG.update.downloading(pending.version));
    try {
      await pending.update.downloadAndInstall();
      set({ pending: null, promptOpen: false });
      setStatus(MSG.update.restarting);
      await relaunch();
    } catch (err) {
      setStatus(errorMessage(err), "error");
    } finally {
      set({ busy: false });
    }
  },
}));
