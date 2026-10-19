import { call } from "@/shared/api/invoke";
import { CMD } from "@/shared/config/commands";
import type { Pack, PackRelease, PackStatus } from "../model/types";

export const packApi = {
  list: () => call<Pack[]>(CMD.listPacks),
  status: (packId: string) => call<PackStatus>(CMD.getPackStatus, { packId }),
  latestRelease: (packId: string) =>
    call<PackRelease>(CMD.fetchPackRelease, { packId }),
  ensure: (packId: string) => call(CMD.ensurePack, { packId }),
  remove: (packId: string) => call(CMD.deletePack, { packId }),
  openFolder: (packId: string) => call(CMD.openPackFolder, { packId }),
  cancelInstall: () => call(CMD.cancelInstall),
};
