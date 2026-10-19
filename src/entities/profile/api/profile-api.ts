import { call } from "@/shared/api/invoke";
import { CMD } from "@/shared/config/commands";
import { FALLBACK_APP_VERSION } from "@/shared/config/limits";
import type { JavaInfo, Profile, RuntimeStatus } from "../model/types";

export const profileApi = {
  get: () => call<Profile>(CMD.getProfile),
  save: (profile: Profile) => call(CMD.saveProfile, { profile }),
  probeJava: (path: string | null) => call<JavaInfo>(CMD.probeJava, { path }),
  appVersion: () =>
    call<string>(CMD.getAppVersion).catch(() => FALLBACK_APP_VERSION),
  runtimeStatus: () => call<RuntimeStatus>(CMD.getRuntimeStatus),
};
