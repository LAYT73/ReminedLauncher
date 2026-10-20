import { MSG } from "@/shared/config/messages";
import { toast } from "@/shared/lib/toast";
import { useProfileStore } from "@/entities/profile";
import { useSessionStore } from "@/entities/session";
import type { CustomTheme, ThemeId } from "@/entities/theme";
import { DEFAULT_CUSTOM_THEME, normalizeCustomTheme } from "@/entities/theme";

export async function copyReminedId(): Promise<void> {
  const id = useSessionStore.getState().reminedId;
  if (!id) return;
  try {
    await navigator.clipboard.writeText(id);
    toast(MSG.profile.copiedId);
  } catch {
    toast(MSG.profile.copyFailed);
  }
}

export async function setTheme(theme: ThemeId): Promise<void> {
  const { profile, persist } = useProfileStore.getState();
  await persist({ ...profile, theme });
}

export async function setCustomTheme(partial: Partial<CustomTheme>): Promise<void> {
  const { profile, persist } = useProfileStore.getState();
  const theme_custom = normalizeCustomTheme({
    ...(profile.theme_custom ?? DEFAULT_CUSTOM_THEME),
    ...partial,
  });
  await persist({ ...profile, theme: "custom", theme_custom });
}

export async function setFriendToasts(enabled: boolean): Promise<void> {
  const { profile, persist } = useProfileStore.getState();
  await persist({ ...profile, friend_toasts: enabled });
}
