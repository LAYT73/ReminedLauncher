import { call } from "@/shared/api/invoke";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CMD } from "@/shared/config/commands";

export type UnlimStatus = {
  installed: boolean;
  path: string | null;
  version: string | null;
  message: string;
  custom_path: boolean;
};

export type UnlimCheckResult = {
  ok: boolean;
  installed: boolean;
  message: string;
  detail: string;
  path: string | null;
  version: string | null;
};

export async function unlimStatus(): Promise<UnlimStatus> {
  return call<UnlimStatus>(CMD.unlimStatus);
}

export async function unlimCheck(): Promise<UnlimCheckResult> {
  return call<UnlimCheckResult>(CMD.unlimCheck);
}

export async function unlimGetPath(): Promise<string | null> {
  return call<string | null>(CMD.unlimGetPath);
}

export async function unlimSetPath(path: string | null): Promise<void> {
  await call(CMD.unlimSetPath, { path });
}

export async function openUnlimDownload(): Promise<void> {
  await openUrl("https://unlim.cc/");
}

export async function unlimLanPort(): Promise<number> {
  return call<number>(CMD.unlimLanPort);
}

export async function unlimCurrentKey(): Promise<string | null> {
  return call<string | null>(CMD.unlimCurrentKey);
}

export type UnlimHostState = {
  key: string | null;
  lan_port: number | null;
  alive: boolean;
};

export async function unlimHostState(): Promise<UnlimHostState> {
  return call<UnlimHostState>(CMD.unlimHostState);
}

/** Start or reuse Unlim host. Pass `lanPort` to reserve Open-to-LAN TCP in the lobby. */
export async function unlimEnsureHost(lanPort?: number | null): Promise<string> {
  return call<string>(CMD.unlimEnsureHost, {
    lanPort: lanPort && lanPort > 0 ? lanPort : null,
  });
}

/** Write mcwifipnp `port` for a pack instance. */
export async function unlimApplyLanPort(
  packId: string,
  port: number,
): Promise<void> {
  await call(CMD.unlimApplyLanPort, { packId, port });
}

export async function unlimStartGameJoin(
  key: string,
  port: number,
): Promise<void> {
  await call(CMD.unlimStartGameJoin, { key, port });
}

export async function unlimStopGameJoin(): Promise<void> {
  await call(CMD.unlimStopGameJoin);
}

export async function unlimStopHost(): Promise<void> {
  await call(CMD.unlimStopHost);
}

/** Prefix Remined stores on presence so guests pick the right tunnel. */
export const UNLIM_SHARE_PREFIX = "unlim:";

export function encodeUnlimShareCode(key: string): string {
  const k = key.trim();
  if (!k) return k;
  return k.toLowerCase().startsWith(UNLIM_SHARE_PREFIX)
    ? k
    : `${UNLIM_SHARE_PREFIX}${k}`;
}

export function decodeUnlimShareCode(code: string): string | null {
  const t = code.trim();
  if (t.toLowerCase().startsWith(UNLIM_SHARE_PREFIX)) {
    return t.slice(UNLIM_SHARE_PREFIX.length).trim() || null;
  }
  // Legacy raw Unlim keys (no prefix).
  if (t.toLowerCase().includes("zshareunlim-")) return t;
  return null;
}

/** True when the friends share code is an Unlim tunnel (not Porthole). */
export function looksLikeUnlimKey(code: string): boolean {
  return decodeUnlimShareCode(code) != null;
}
