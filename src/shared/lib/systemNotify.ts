import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { create } from "zustand";
import { STORAGE_KEY } from "@/shared/config/storage-keys";

/** Local per-device pref: native OS notifications while the launcher is in the background. */
const KEY = STORAGE_KEY.systemNotify;

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

type SystemNotifyPrefs = {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
};

export const useSystemNotifyPrefs = create<SystemNotifyPrefs>((set) => ({
  enabled: load(),
  setEnabled: (v) => {
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    set({ enabled: v });
  },
}));

/** Launcher window is shown and focused: the in-app UI already tells the user. */
function isInForeground(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/** Asks for OS permission on first use only. */
async function ensurePermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Native OS notification, sent only when the pref is on and the launcher is in the background. */
export async function notifySystem(title: string, body: string): Promise<void> {
  if (!useSystemNotifyPrefs.getState().enabled || isInForeground()) return;
  if (!(await ensurePermission())) return;
  try {
    sendNotification({ title, body });
  } catch {
    /* notifications unavailable on this system */
  }
}
