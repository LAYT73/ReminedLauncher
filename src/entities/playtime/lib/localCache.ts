import { STORAGE_KEY } from "@/shared/config/storage-keys";
import type { PlayStats } from "@/shared/lib/playtime";

function key(userId: string): string {
  return `${STORAGE_KEY.packPlaytimePrefix}${userId}`;
}

export function readLocalPackPlaytimes(
  userId: string | null | undefined,
): Record<string, PlayStats> {
  if (!userId || typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PlayStats>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, PlayStats> = {};
    for (const [id, st] of Object.entries(parsed)) {
      if (!id || !st || typeof st !== "object") continue;
      out[id] = {
        playtimeSeconds: Math.max(0, Number(st.playtimeSeconds) || 0),
        lastPlayedAt: st.lastPlayedAt ?? null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function writeLocalPackPlaytimes(
  userId: string | null | undefined,
  byPack: Record<string, PlayStats>,
): void {
  if (!userId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key(userId), JSON.stringify(byPack));
  } catch {
    /* quota / private mode */
  }
}

export function mergePlayStats(
  a: PlayStats | null | undefined,
  b: PlayStats | null | undefined,
): PlayStats | null {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a;
  const playtimeSeconds = Math.max(a.playtimeSeconds, b.playtimeSeconds);
  const ta = a.lastPlayedAt ? Date.parse(a.lastPlayedAt) : 0;
  const tb = b.lastPlayedAt ? Date.parse(b.lastPlayedAt) : 0;
  const lastPlayedAt =
    ta >= tb ? a.lastPlayedAt : b.lastPlayedAt;
  return { playtimeSeconds, lastPlayedAt };
}
