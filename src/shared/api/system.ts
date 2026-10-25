import { call } from "@/shared/api/invoke";
import { CMD } from "@/shared/config/commands";

/** Total physical RAM in MB. */
export function systemMemoryMb(): Promise<number> {
  return call<number>(CMD.systemMemoryMb);
}
