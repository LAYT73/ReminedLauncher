import { t, type TKey } from "@/shared/i18n";
import { STORAGE_KEY } from "@/shared/config/storage-keys";

const PREFIX = STORAGE_KEY.achievementPrefix;

export type AchievementId = "first-voice-room" | "first-network-join";

const COPY: Record<AchievementId, TKey> = {
  "first-voice-room": "social.achievements.firstVoiceRoom",
  "first-network-join": "social.achievements.firstNetworkJoin",
};

/** Fires the toast once per install (localStorage). Returns true when newly unlocked. */
export function unlockAchievement(
  id: AchievementId,
  toast: (msg: string, tone?: "default" | "ok" | "err") => void,
): boolean {
  try {
    if (localStorage.getItem(PREFIX + id)) return false;
    localStorage.setItem(PREFIX + id, String(Date.now()));
  } catch {
    return false;
  }
  toast(t(COPY[id]), "ok");
  return true;
}
