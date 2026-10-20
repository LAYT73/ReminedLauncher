import { create } from "zustand";
import { applyTheme } from "@/entities/theme";
import { FALLBACK_APP_VERSION, FALLBACK_USERNAME } from "@/shared/config/limits";
import { profileApi } from "../api/profile-api";
import { DEFAULT_PROFILE } from "../lib/profile";
import type { JavaInfo, Profile } from "./types";

type ProfileState = {
  profile: Profile;
  javaInfo: JavaInfo | null;
  appVersion: string;
  /** Username input draft; `null` = not editing. */
  usernameDraft: string | null;
  usernameBusy: boolean;
  setProfile: (profile: Profile) => void;
  setJavaInfo: (info: JavaInfo | null) => void;
  setAppVersion: (version: string) => void;
  setUsernameDraft: (draft: string | null) => void;
  setUsernameBusy: (busy: boolean) => void;
  /** Update state + theme and write `profile.json`. */
  persist: (next: Profile) => Promise<void>;
  /** Re-probe the configured Java (or the managed one for `null`). */
  refreshJava: (path?: string | null) => Promise<void>;
};

export const useProfileStore = create<ProfileState>((set) => ({
  profile: DEFAULT_PROFILE,
  javaInfo: null,
  appVersion: FALLBACK_APP_VERSION,
  usernameDraft: null,
  usernameBusy: false,
  setProfile: (profile) => set({ profile }),
  setJavaInfo: (javaInfo) => set({ javaInfo }),
  setAppVersion: (appVersion) => set({ appVersion }),
  setUsernameDraft: (usernameDraft) => set({ usernameDraft }),
  setUsernameBusy: (usernameBusy) => set({ usernameBusy }),
  persist: async (next) => {
    set({ profile: next });
    applyTheme(next.theme, next.theme_custom);
    await profileApi.save(next);
  },
  refreshJava: async (path) => {
    try {
      const trimmed = path?.trim();
      set({ javaInfo: await profileApi.probeJava(trimmed ? trimmed : null) });
    } catch {
      set({ javaInfo: null });
    }
  },
}));

/** Display name: trimmed username or the fallback. */
export function committedUsername(profile: Pick<Profile, "username">): string {
  return profile.username.trim() || FALLBACK_USERNAME;
}
