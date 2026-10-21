import type { SkinModelKind } from "@/entities/skin";
import type { CustomTheme, ThemeId } from "@/entities/theme";

/** Tunnel backend for Network Play + Voice. */
export type NetworkMode = "unlim" | "hybrid";

export type Profile = {
  username: string;
  skin_path: string | null;
  /** Custom cape PNG URL (same skins bucket as `{nick}_cape.png`). */
  cape_path: string | null;
  skin_model: SkinModelKind;
  selected_pack: string;
  ram_mb: number;
  java_path: string | null;
  jvm_args: string;
  theme: ThemeId;
  /** Desktop Steam-like friend play toasts. */
  friend_toasts: boolean;
  /**
   * `unlim` — voice + LAN on Unlim (default, no Porthole).
   * `hybrid` — voice Unlim + LAN Porthole (legacy).
   */
  network_mode: NetworkMode;
  /** Open-to-LAN / mcwifipnp port (also reserved on Unlim when mode is unlim). */
  lan_port: number;
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
