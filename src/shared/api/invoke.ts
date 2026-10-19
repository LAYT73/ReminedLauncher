import { invoke } from "@tauri-apps/api/core";
import type { Command } from "@/shared/config/commands";

/** Typed wrapper around Tauri `invoke`: only known command names are accepted. */
export function call<T = void>(
  command: Command,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args);
}
