import { call } from "@/shared/api/invoke";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CMD } from "@/shared/config/commands";

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

/** True when the friends share code is a Remined Relay tunnel (not Porthole). */
export function looksLikeRelayKey(code: string): boolean {
  return decodeRelayShareCode(code) != null;
}
