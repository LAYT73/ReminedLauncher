/** Best-effort online check for Tauri / WKWebView. */

export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/**
 * Probe a cheap HEAD/GET. Falls back to `navigator.onLine` if the probe fails
 * for non-network reasons (CORS, etc.).
 */
export async function probeOnline(
  url?: string,
  timeoutMs = 2500,
): Promise<boolean> {
  if (!isBrowserOnline()) return false;
  const target =
    url ||
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
    "https://github.com";
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(target, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: ctrl.signal,
    });
    return true;
  } catch {
    // no-cors opaque success still resolves; abort/network throw → offline-ish
    return isBrowserOnline();
  } finally {
    window.clearTimeout(timer);
  }
}

export function subscribeConnectivity(
  onChange: (online: boolean) => void,
): () => void {
  const fire = () => onChange(isBrowserOnline());
  window.addEventListener("online", fire);
  window.addEventListener("offline", fire);
  return () => {
    window.removeEventListener("online", fire);
    window.removeEventListener("offline", fire);
  };
}
