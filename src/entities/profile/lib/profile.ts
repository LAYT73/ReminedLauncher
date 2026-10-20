import type { Profile } from "../model/types";
import { normalizeSkinModel } from "@/entities/skin";
import {
  DEFAULT_CUSTOM_THEME,
  DEFAULT_THEME,
  normalizeCustomTheme,
  normalizeThemeId,
} from "@/entities/theme";
import { FALLBACK_USERNAME } from "@/shared/config/limits";

export const RAM_OPTIONS_GB = [2, 4, 6, 8, 10, 12, 16] as const;

export const DEFAULT_PROFILE: Profile = {
  username: FALLBACK_USERNAME,
  skin_path: null,
  skin_model: "default",
  selected_pack: "",
  ram_mb: 4096,
  java_path: null,
  jvm_args: "",
  theme: DEFAULT_THEME,
  friend_toasts: true,
  theme_custom: null,
};

export function normalizeProfile(raw: Partial<Profile> | null | undefined): Profile {
  const theme = normalizeThemeId(raw?.theme);
  const themeCustom =
    raw?.theme_custom != null
      ? normalizeCustomTheme(raw.theme_custom)
      : theme === "custom"
        ? { ...DEFAULT_CUSTOM_THEME }
        : null;

  return {
    ...DEFAULT_PROFILE,
    ...raw,
    skin_model: normalizeSkinModel(raw?.skin_model),
    ram_mb: Math.max(1024, Number(raw?.ram_mb) || DEFAULT_PROFILE.ram_mb),
    java_path: raw?.java_path ?? null,
    jvm_args: raw?.jvm_args ?? "",
    theme,
    friend_toasts: raw?.friend_toasts !== false,
    theme_custom: themeCustom,
  };
}
