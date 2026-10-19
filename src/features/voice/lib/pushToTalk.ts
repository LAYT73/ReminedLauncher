import {
  register,
  unregister,
} from "@tauri-apps/plugin-global-shortcut";
import { STORAGE_KEY } from "@/shared/config/storage-keys";

const KEY = STORAGE_KEY.voicePtt;

export const PTT_KEYS: { id: string; label: string }[] = [
  { id: "F8", label: "F8" },
  { id: "F9", label: "F9" },
  { id: "F10", label: "F10" },
  { id: "Control+Space", label: "Ctrl + Space" },
  { id: "Alt+V", label: "Alt + V" },
];

export type PttConfig = { enabled: boolean; key: string };

export function loadPttConfig(): PttConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PttConfig>;
      return {
        enabled: Boolean(v.enabled),
        key: PTT_KEYS.some((k) => k.id === v.key) ? (v.key as string) : "F9",
      };
    }
  } catch {
    /* ignore */
  }
  return { enabled: false, key: "F9" };
}

export function savePttConfig(cfg: PttConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

/**
 * Register a *global* hotkey (works while Minecraft has focus). Returns an unbind function.
 * Throws when registration fails (key already taken, permissions).
 */
export async function bindPushToTalk(
  accelerator: string,
  onChange: (down: boolean) => void,
): Promise<() => Promise<void>> {
  await register(accelerator, (ev) => {
    if (ev.state === "Pressed") onChange(true);
    else if (ev.state === "Released") onChange(false);
  });
  return async () => {
    onChange(false);
    try {
      await unregister(accelerator);
    } catch {
      /* ignore */
    }
  };
}
