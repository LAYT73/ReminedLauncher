import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

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
  return invoke<PortholeStatus>("porthole_status");
}

export async function portholeSelftest(): Promise<PortholeCheckResult> {
  return invoke<PortholeCheckResult>("porthole_selftest");
}

export async function portholeStartHost(port: number): Promise<PortholeHostInfo> {
  return invoke<PortholeHostInfo>("porthole_start_host", { port });
}

export async function portholeStartJoin(
  shareCode: string,
  port: number,
): Promise<void> {
  await invoke("porthole_start_join", { shareCode, port });
}

export async function portholeStopHost(): Promise<void> {
  await invoke("porthole_stop_host");
}

export async function portholeStopJoin(): Promise<void> {
  await invoke("porthole_stop_join");
}

export async function portholeStopAll(): Promise<void> {
  await invoke("porthole_stop_all");
}

export async function portholeCurrentHost(): Promise<PortholeHostInfo | null> {
  return invoke<PortholeHostInfo | null>("porthole_current_host");
}

export async function readLanPort(packId: string): Promise<number | null> {
  const port = await invoke<number | null>("read_lan_port", { packId });
  return port && port > 0 ? port : null;
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
