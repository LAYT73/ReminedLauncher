import { TIMING } from "@/shared/config/timings";

/** Best-effort online check for Tauri / WKWebView. */

/** Dev-only: `VITE_FORCE_OFFLINE=1 npm run tauri:dev:offline` */
export function isForceOffline(): boolean {
  const flag = import.meta.env.VITE_FORCE_OFFLINE;
  return flag === "1" || flag === "true";
}

export function isBrowserOnline(): boolean {
  if (isForceOffline()) return false;
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/**
 * Probe a cheap HEAD/GET. Abort/network failure means offline — do not fall
 * back to navigator.onLine (often true with Wi‑Fi but no internet).
 */
export async function probeOnline(
  url?: string,
  timeoutMs = TIMING.networkProbe,
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
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Reject (or resolve fallback) if `promise` does not settle in time. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback?: () => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (fallback) resolve(fallback());
      else reject(new Error("timeout"));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        if (fallback) resolve(fallback());
        else reject(err);
      },
    );
  });
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
