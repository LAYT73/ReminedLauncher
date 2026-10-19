import { MSG } from "@/shared/config/messages";
import { toast } from "@/shared/lib/toast";
import { useProfileStore } from "@/entities/profile";
import { useSessionStore } from "@/entities/session";
import type { ThemeId } from "@/entities/theme";

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
