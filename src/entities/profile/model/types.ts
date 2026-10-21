import type { SkinModelKind } from "@/entities/skin";
import type { CustomTheme, ThemeId } from "@/entities/theme";

/** Tunnel backend id (always Remined Relay; legacy `hybrid` coerced away). */
export type NetworkMode = "relay";

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
  /** Desktop friend play toasts. */
  friend_toasts: boolean;
  /** Always Remined Relay (`relay` id kept for profile JSON compat). */
  network_mode: NetworkMode;
  /** Legacy preferred LAN port (unused — tunnel follows Minecraft's real port). */
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
