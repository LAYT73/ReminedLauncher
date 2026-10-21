import { LogicalPosition, LogicalSize, primaryMonitor } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { CustomTheme } from "@/entities/theme";

export const FRIEND_TOAST_LABEL = "friend-toast";
export const FRIEND_TOAST_STORAGE_KEY = "remined.friend-toast";
/** Query param carrying the toast payload (WebView2 may not share localStorage). */
export const FRIEND_TOAST_QUERY = "toast";

export type FriendToastPayload = {
  title: string;
  /** Status kind, e.g. Playing / Hosting */
  kind: string;
  /** Pack / game name shown next to kind */
  detail?: string | null;
  skinUrl?: string | null;
  /** Active launcher theme so the overlay matches the main UI */
  themeId?: string | null;
  themeCustom?: CustomTheme | null;
};

const TOAST_W = 336;
const TOAST_H = 88;
const MARGIN = 18;

/** Survives React StrictMode double-mount in the toast webview. */
let memoryPayload: FriendToastPayload | null = null;

function encodeToastPayload(payload: FriendToastPayload): string {
  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode payload from the toast window URL (preferred) or legacy localStorage. */
export function decodeToastPayload(encoded: string): FriendToastPayload | null {
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4 || 4)) % 4);
    const json = decodeURIComponent(escape(atob(pad)));
    const parsed = JSON.parse(json) as FriendToastPayload;
    if (!parsed?.title) return null;
    return {
      title: parsed.title,
      kind: parsed.kind || "Playing",
      detail: parsed.detail ?? null,
      skinUrl: parsed.skinUrl ?? null,
      themeId: parsed.themeId ?? null,
      themeCustom: parsed.themeCustom ?? null,
    };
  } catch {
    return null;
  }
}

/** Persist payload for the overlay window (separate webview can't share React state). */
export function stashFriendToast(payload: FriendToastPayload): void {
  memoryPayload = payload;
  try {
    localStorage.setItem(
      FRIEND_TOAST_STORAGE_KEY,
      JSON.stringify({ ...payload, at: Date.now() }),
    );
  } catch {
    /* ignore quota */
  }
}

export function takeFriendToast(): FriendToastPayload | null {
  if (typeof window !== "undefined") {
    const fromUrl = new URLSearchParams(window.location.search).get(
      FRIEND_TOAST_QUERY,
    );
    if (fromUrl) {
      const decoded = decodeToastPayload(fromUrl);
      if (decoded) {
        memoryPayload = decoded;
        return decoded;
      }
    }
  }
  if (memoryPayload?.title) return memoryPayload;
  try {
    const raw = localStorage.getItem(FRIEND_TOAST_STORAGE_KEY);
    localStorage.removeItem(FRIEND_TOAST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FriendToastPayload & { at?: number };
    if (!parsed?.title) return null;
    memoryPayload = {
      title: parsed.title,
      kind: parsed.kind || "Playing",
      detail: parsed.detail ?? null,
      skinUrl: parsed.skinUrl ?? null,
      themeId: parsed.themeId ?? null,
      themeCustom: parsed.themeCustom ?? null,
    };
    return memoryPayload;
  } catch {
    return null;
  }
}

/**
 * Desktop friend toast: always-on-top undecorated window, bottom-right of the
 * primary monitor (outside the launcher chrome), themed like Remined panels.
 *
 * Windows: main window sets `additionalBrowserArgs` (proxy bypass). WebView2
 * refuses a second webview with different args on the same data folder — toast
 * creation used to fail silently. Use a dedicated `dataDirectory` and pass the
 * payload in the URL (localStorage is not shared across data dirs).
 */
export async function showFriendDesktopToast(
  payload: FriendToastPayload,
): Promise<void> {
  stashFriendToast(payload);

  const mon = await primaryMonitor().catch(() => null);
  let x = 40;
  let y = 40;
  if (mon) {
    const scale = mon.scaleFactor || 1;
    const workX = mon.workArea.position.x / scale;
    const workY = mon.workArea.position.y / scale;
    const workW = mon.workArea.size.width / scale;
    const workH = mon.workArea.size.height / scale;
    x = Math.round(workX + workW - TOAST_W - MARGIN);
    y = Math.round(workY + workH - TOAST_H - MARGIN);
  }

  const existing = await WebviewWindow.getByLabel(FRIEND_TOAST_LABEL);
  if (existing) {
    try {
      await existing.close();
    } catch {
      /* may already be closing */
    }
    await new Promise((r) => window.setTimeout(r, 80));
  }

  const encoded = encodeToastPayload(payload);
  const win = new WebviewWindow(FRIEND_TOAST_LABEL, {
    url: `index.html?window=friend-toast&${FRIEND_TOAST_QUERY}=${encoded}`,
    title: "Remined",
    width: TOAST_W,
    height: TOAST_H,
    x,
    y,
    resizable: false,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focus: false,
    visible: true,
    shadow: false,
    // Windows: avoid white flash + match WebView2 env rules (see module doc).
    noRedirectionBitmap: true,
    dataDirectory: "friend-toast",
  });

  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => resolve(), 2500);
    win.once("tauri://created", () => {
      window.clearTimeout(t);
      resolve();
    });
    win.once("tauri://error", (e) => {
      window.clearTimeout(t);
      reject(e);
    });
  });

  try {
    await win.setPosition(new LogicalPosition(x, y));
    await win.setSize(new LogicalSize(TOAST_W, TOAST_H));
    await win.setAlwaysOnTop(true);
    await win.show();
  } catch {
    /* window may still be usable */
  }
}
