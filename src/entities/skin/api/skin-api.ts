import { call } from "@/shared/api/invoke";
import { CMD } from "@/shared/config/commands";

export const skinApi = {
  /** Local PNG → data URL (null when unreadable). */
  readDataUrl: (path: string) =>
    call<string | null>(CMD.readSkinDataUrl, { path }),
  materialize: (skin: string) =>
    call<string>(CMD.materializeSkinPath, { skin }),
};
