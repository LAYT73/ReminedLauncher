import { STORAGE_KEY } from "@/shared/config/storage-keys";

const PREFIX = STORAGE_KEY.achievementPrefix;

export type AchievementId = "first-voice-room" | "first-network-join";

const COPY: Record<AchievementId, string> = {
  "first-voice-room": "Achievement unlocked: First voice room",
  "first-network-join": "Achievement unlocked: First Network Play join",
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
  toast(COPY[id], "ok");
  return true;
}
