import { call } from "@/shared/api/invoke";
import { CMD } from "@/shared/config/commands";
import type { Locale } from "@/shared/i18n";

export const FRIEND_TOAST_LABEL = "friend-toast";
export const FRIEND_TOAST_STORAGE_KEY = "remined.friend-toast";
/** Query param carrying the toast payload (WebView2 may not share localStorage). */
export const FRIEND_TOAST_QUERY = "toast";

/** Fields the overlay applies; structurally matches the launcher custom theme. */
export type FriendToastCustomTheme = {
  mode: "dark" | "light";
  accent: string;
  surface: string;
};

export type FriendToastPayload = {
  title: string;
  /** Status kind, e.g. Playing / Hosting */
  kind: string;
  /** Pack / game name shown next to kind */
  detail?: string | null;
  skinUrl?: string | null;
  /** Active launcher theme so the overlay matches the main UI */
  themeId?: string | null;
  themeCustom?: FriendToastCustomTheme | null;
  /** Launcher UI language (the overlay is a separate webview with its own storage) */
  locale?: Locale | null;
};

const TOAST_W = 336;
const TOAST_H = 88;

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
      locale: parsed.locale ?? null,
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
      locale: parsed.locale ?? null,
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
 * The window is created in Rust (`show_friend_toast`) with the same WebView2
 * browser args as the main window; the payload travels in the URL query.
 */
export async function showFriendDesktopToast(
  payload: FriendToastPayload,
): Promise<void> {
  const query = `${FRIEND_TOAST_QUERY}=${encodeToastPayload(payload)}`;
  await call(CMD.showFriendToast, { query, width: TOAST_W, height: TOAST_H });
}
