/** Cached WAN IPv4 for copyable LAN address hints (not used for Porthole itself). */

let cached: string | null = null;
let inflight: Promise<string | null> | null = null;

function looksLikeIpv4(s: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  if (!m) return false;
  return m.slice(1).every((p) => {
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

/** Best-effort public IPv4; null offline / blocked. Result is memoized. */
export async function fetchPublicIpv4(): Promise<string | null> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch("https://api.ipify.org?format=text", {
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) return null;
      const text = (await res.text()).trim();
      if (!looksLikeIpv4(text)) return null;
      cached = text;
      return text;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
      inflight = null;
    }
  })();
  return inflight;
}

/** Normalize Minecraft "Connecting to host, port" / quoted junk → `host:port`. */
export function normalizeServerAddress(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^['"]+|['"]+$/g, "");
  // `name: '127.0.0.1:25565'` or nested quotes
  const nested = s.match(/['"](\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})['"]/);
  if (nested?.[1]) return nested[1];
  const ipPort = s.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/);
  if (ipPort) return `${ipPort[1]}:${ipPort[2]}`;
  // host, port → host:port (already partly done in Rust)
  s = s.replace(/,\s*/g, ":");
  s = s.replace(/['"]/g, "");
  // Drop a leading label before the address: `tralala: 127.0.0.1:25565`
  const labeled = s.match(/^[^:]+:\s*(.+)$/);
  if (labeled?.[1] && /:\d+$/.test(labeled[1])) return labeled[1].trim();
  return s.trim();
}

export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}
