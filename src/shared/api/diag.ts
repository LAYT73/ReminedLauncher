import { call } from "@/shared/api/invoke";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CMD } from "@/shared/config/commands";

/** `<remined>/.remined/logs` — app.log lives here. */
export async function diagLogsDir(): Promise<string> {
  return call<string>(CMD.diagLogsDir);
}

/** Reveal the launcher logs folder in Finder / Explorer. */
export async function revealDiagLogs(): Promise<string> {
  const path = await diagLogsDir();
  await revealItemInDir(path);
  return path;
}
