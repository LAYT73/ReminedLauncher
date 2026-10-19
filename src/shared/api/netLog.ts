import { call } from "@/shared/api/invoke";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CMD } from "@/shared/config/commands";

/** Append a line to the chunked network log (never throws). */
export async function netLog(source: string, message: string): Promise<void> {
  try {
    await call(CMD.netLogAppend, { source, message });
  } catch {
    /* logging must never break play */
  }
}

export async function netLogDir(): Promise<string> {
  return call<string>(CMD.netLogDir);
}

export async function netLogTail(maxBytes = 64_000): Promise<string> {
  return call<string>(CMD.netLogTail, { maxBytes });
}

export async function netLogList(): Promise<string[]> {
  return call<string[]>(CMD.netLogList);
}

/** Reveal `.remined/network/` in Finder / Explorer. */
export async function netRevealLogDir(): Promise<string> {
  const path = await netLogDir();
  await revealItemInDir(path);
  return path;
}
