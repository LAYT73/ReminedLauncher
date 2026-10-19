import { call } from "@/shared/api/invoke";
import { EDITIONS } from "../config/editions";
import type { Edition, VersionList } from "../model/types";

export const versionApi = {
  list: async (edition: Edition): Promise<VersionList> => {
    const cfg = EDITIONS[edition];
    return cfg.parseList((await call(cfg.listCommand)) as never);
  },
  install: (edition: Edition, versionId: string) =>
    call<{ id: string }>(EDITIONS[edition].installCommand, { versionId }),
};
