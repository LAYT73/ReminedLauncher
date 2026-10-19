import { call } from "@/shared/api/invoke";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CMD } from "@/shared/config/commands";

export type PortholeStatus = {
  installed: boolean;
  path: string | null;
  version: string | null;
  steam_ok: boolean | null;
  message: string;
  store_url: string;
  steam_deep_link: string;
  steam_install_link: string;
  steam_app_id: string;
};

export type PortholeHostInfo = {
  share_code: string;
  port: number;
};

export type PortholeCheckResult = {
  ok: boolean;
  installed: boolean;
  steam_ok: boolean;
  message: string;
  detail: string;
};

export async function portholeStatus(): Promise<PortholeStatus> {
  return call<PortholeStatus>(CMD.portholeStatus);
}

export async function portholeSelftest(): Promise<PortholeCheckResult> {
  return call<PortholeCheckResult>(CMD.portholeSelftest);
}

export async function portholeStartHost(port: number): Promise<PortholeHostInfo> {
  return call<PortholeHostInfo>(CMD.portholeStartHost, { port });
}

export async function portholeStartJoin(
  shareCode: string,
  port: number,
): Promise<void> {
  await call(CMD.portholeStartJoin, { shareCode, port });
}

export async function portholeStopHost(): Promise<void> {
  await call(CMD.portholeStopHost);
}

export async function portholeStopJoin(): Promise<void> {
  await call(CMD.portholeStopJoin);
}

export async function portholeStopAll(): Promise<void> {
  await call(CMD.portholeStopAll);
}

export async function portholeCurrentHost(): Promise<PortholeHostInfo | null> {
  return call<PortholeHostInfo | null>(CMD.portholeCurrentHost);
}

export async function readLanPort(packId: string): Promise<number | null> {
  const port = await call<number | null>(CMD.readLanPort, { packId });
  return port && port > 0 ? port : null;
}

/** Find Steam on disk (standard macOS/Windows paths) and launch it. */
export async function openSteamClient(): Promise<string> {
  return call<string>(CMD.openSteamClient);
}

/** Prefer Steam deep link; fall back to store page in browser. */
export async function openPortholeOnSteam(
  status?: PortholeStatus | null,
): Promise<void> {
  const st = status ?? (await portholeStatus());
  try {
    await openUrl(st.installed ? st.steam_deep_link : st.steam_install_link);
  } catch {
    await openUrl(st.store_url);
  }
}

export async function openPortholeStore(
  status?: PortholeStatus | null,
): Promise<void> {
  const st = status ?? (await portholeStatus());
  try {
    await openUrl(st.steam_deep_link);
  } catch {
    await openUrl(st.store_url);
  }
}
