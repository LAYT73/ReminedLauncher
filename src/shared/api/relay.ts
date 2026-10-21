import { call } from "@/shared/api/invoke";
import { supabase } from "@/shared/api/supabase";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CMD } from "@/shared/config/commands";

type RelayCredsResponse = {
  serverAddr: string;
  serverPort: number;
  token: string;
  ttlSec?: number;
};

let credsFetchedAt = 0;
let credsTtlMs = 50 * 60 * 1000;

export type RelayStatus = {
  installed: boolean;
  path: string | null;
  version: string | null;
  message: string;
  custom_path: boolean;
};

export type RelayCheckResult = {
  ok: boolean;
  installed: boolean;
  message: string;
  detail: string;
  path: string | null;
  version: string | null;
};

export async function relayStatus(): Promise<RelayStatus> {
  return call<RelayStatus>(CMD.relayStatus);
}

export async function relayCheck(): Promise<RelayCheckResult> {
  return call<RelayCheckResult>(CMD.relayCheck);
}

export async function relayGetPath(): Promise<string | null> {
  return call<string | null>(CMD.relayGetPath);
}

export async function relaySetPath(path: string | null): Promise<void> {
  await call(CMD.relaySetPath, { path });
}

export async function openRelayDownload(): Promise<void> {
  // frpc is auto-downloaded on Check; this opens the frp release page as fallback.
  await openUrl("https://github.com/fatedier/frp/releases");
}

export async function relayLanPort(): Promise<number> {
  return call<number>(CMD.relayLanPort);
}

export async function relayCurrentKey(): Promise<string | null> {
  return call<string | null>(CMD.relayCurrentKey);
}

export type RelayHostState = {
  key: string | null;
  lan_port: number | null;
  alive: boolean;
};

export async function relayHostState(): Promise<RelayHostState> {
  return call<RelayHostState>(CMD.relayHostState);
}

/** Start or reuse Remined Relay host. Pass `lanPort` to attach Open-to-LAN (hot). */
export async function relayEnsureHost(lanPort?: number | null): Promise<string> {
  return call<string>(CMD.relayEnsureHost, {
    lanPort: lanPort && lanPort > 0 ? lanPort : null,
  });
}

/** Hot-add LAN to a live voice relay without reconnecting LiveKit. */
export async function relayAttachLan(port: number): Promise<string> {
  return call<string>(CMD.relayAttachLan, { port });
}

/** Drop LAN proxy only; returns updated share key (voice stays up). */
export async function relayDetachLan(): Promise<string | null> {
  return call<string | null>(CMD.relayDetachLan);
}

/** Write mcwifipnp `port` for a pack instance. */
export async function relayApplyLanPort(
  packId: string,
  port: number,
): Promise<void> {
  await call(CMD.relayApplyLanPort, { packId, port });
}

export async function relayStartGameJoin(
  key: string,
  port: number,
): Promise<void> {
  await call(CMD.relayStartGameJoin, { key, port });
}

export async function relayStopGameJoin(): Promise<void> {
  await call(CMD.relayStopGameJoin);
}

export async function relayStopHost(): Promise<void> {
  await call(CMD.relayStopHost);
}

/** Prefix Remined stores on presence so guests pick the right tunnel. */
export const RELAY_SHARE_PREFIX = "rmd:";

export function encodeRelayShareCode(key: string): string {
  const k = key.trim();
  if (!k) return k;
  if (k.toLowerCase().startsWith(RELAY_SHARE_PREFIX)) return k;
  if (k.startsWith("rmd1_")) return `${RELAY_SHARE_PREFIX}${k}`;
  return `${RELAY_SHARE_PREFIX}${k}`;
}

export function decodeRelayShareCode(code: string): string | null {
  const t = code.trim();
  if (t.toLowerCase().startsWith(RELAY_SHARE_PREFIX)) {
    return t.slice(RELAY_SHARE_PREFIX.length).trim() || null;
  }
  // Raw Remined relay keys (no prefix).
  if (t.startsWith("rmd1_")) return t;
  // Legacy Relay keys — no longer supported.
  if (t.toLowerCase().includes("zsharerelay-")) return null;
  // Legacy `relay:` wrapper around rmd1_ or old keys.
  if (t.toLowerCase().startsWith("relay:")) {
    const inner = t.slice("relay:".length).trim();
    if (inner.startsWith("rmd1_")) return inner;
    return null;
  }
  return null;
}

/** True when a friends share code is a Remined Relay tunnel. */
export function looksLikeRelayKey(code: string): boolean {
  return decodeRelayShareCode(code) != null;
}

/**
 * Session identity for voice reconnect: `id_sk` only.
 * LAN port suffix changes must not force a LiveKit reconnect.
 */
export function relaySessionCore(code: string | null | undefined): string | null {
  if (!code?.trim()) return null;
  const raw = decodeRelayShareCode(code) ?? code.trim();
  const body = raw.startsWith("rmd1_") ? raw.slice("rmd1_".length) : raw;
  const parts = body.split("_");
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return `${parts[0]}_${parts[1]}`;
  }
  return raw;
}

/** Download frpc if missing (same as Network → Check). */
export async function ensureRelayInstalled(): Promise<void> {
  const st = await relayStatus();
  if (st.installed) return;
  const check = await relayCheck();
  if (!check.ok || !check.installed) {
    throw new Error(check.message || "Failed to install Remined Relay (frpc)");
  }
}

/**
 * Fetch frps credentials from Supabase (authenticated) and push them into Rust.
 * Cached in-process for ~ttl so we do not hit the edge function every poll.
 */
export async function ensureRelayCreds(force = false): Promise<void> {
  const now = Date.now();
  if (!force && credsFetchedAt > 0 && now - credsFetchedAt < credsTtlMs) {
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sign in to use Remined Relay");
  }

  const { data, error } = await supabase.functions.invoke<RelayCredsResponse>(
    "relay-creds",
    { method: "POST" },
  );
  if (error) {
    throw new Error(error.message || "Failed to fetch Remined Relay credentials");
  }
  if (!data?.serverAddr || !data?.token || !data?.serverPort) {
    throw new Error("Remined Relay credentials response was empty");
  }

  await call(CMD.relaySetCreds, {
    addr: data.serverAddr,
    port: data.serverPort,
    token: data.token,
  });

  credsFetchedAt = now;
  if (typeof data.ttlSec === "number" && data.ttlSec > 60) {
    // Refresh a bit before the hinted TTL.
    credsTtlMs = Math.max(60_000, (data.ttlSec - 120) * 1000);
  }
}

/** Creds from Supabase + frpc binary ready. */
export async function ensureRelayReady(): Promise<void> {
  await ensureRelayCreds();
  await ensureRelayInstalled();
}
