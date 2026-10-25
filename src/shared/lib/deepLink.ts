/** A parsed `remined://` link. Anything else parses to `null`. */
export type DeepLink =
  | { kind: "join"; shareCode: string }
  | { kind: "pack"; packId: string }
  | { kind: "party"; roomId: string };

const SCHEME = "remined:";
/** Same prefix `encodeRelayShareCode` puts on relay keys (see `shared/api/relay.ts`). */
const RELAY_PREFIX = "rmd:";
const PACK_ID = /^[A-Za-z0-9._-]{1,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return "";
  }
}

/**
 * Parse `remined://join/<code>`, `remined://pack/<id>` and `remined://party/<roomId>`.
 * The join code is returned with the `rmd:` prefix, whether or not the link had it.
 */
export function parseDeepLink(raw: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== SCHEME) return null;

  // `remined://join/x` keeps "join" in the host slot.
  const action = url.hostname.toLowerCase();
  const segment = decodeSegment(url.pathname.replace(/^\/+|\/+$/g, ""));
  if (!segment) return null;

  if (action === "join") {
    const bare = segment.toLowerCase().startsWith(RELAY_PREFIX)
      ? segment.slice(RELAY_PREFIX.length).trim()
      : segment;
    return bare ? { kind: "join", shareCode: RELAY_PREFIX + bare } : null;
  }
  if (action === "pack" && PACK_ID.test(segment)) {
    return { kind: "pack", packId: segment };
  }
  if (action === "party" && UUID.test(segment)) {
    return { kind: "party", roomId: segment.toLowerCase() };
  }
  return null;
}
