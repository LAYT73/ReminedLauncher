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
