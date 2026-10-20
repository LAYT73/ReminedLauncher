import type { SkinModelKind } from "@/entities/skin";
import type { CustomTheme, ThemeId } from "@/entities/theme";

export type Profile = {
  username: string;
  skin_path: string | null;
  skin_model: SkinModelKind;
  selected_pack: string;
  ram_mb: number;
  java_path: string | null;
  jvm_args: string;
  theme: ThemeId;
  /** Desktop Steam-like friend play toasts. */
  friend_toasts: boolean;
  /** Used when `theme === "custom"`. */
  theme_custom: CustomTheme | null;
};

export type JavaInfo = {
  path: string;
  version: string;
  major: number | null;
  ok: boolean;
};

export type RuntimeStatus = {
  onboarding: {
    completed: boolean;
    java_ok: boolean;
    java_path: string | null;
  };
};
