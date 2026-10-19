import { call } from "@/shared/api/invoke";
import { CMD } from "@/shared/config/commands";
import type {
  CrashInfo,
  GameLiveStatus,
  GamePhase,
  LaunchResult,
} from "../model/types";

export type LaunchArgs = {
  packId: string;
  username: string;
  skinPath: string | null;
  skinModel: string;
  quickPlay: string | null;
};

export const gameApi = {
  phase: () => call<GamePhase>(CMD.getGamePhase),
  launch: (args: LaunchArgs) => call<LaunchResult>(CMD.launchPack, args),
  liveStatus: (packId: string) =>
    call<GameLiveStatus>(CMD.gameLogStatus, { packId }),
  latestCrash: (packId: string, sinceMs: number) =>
    call<CrashInfo | null>(CMD.latestCrashReport, { packId, sinceMs }),
};
