import { useEffect, useRef } from "react";
import { listFriendships } from "@/entities/friend";
import { useProfileStore } from "@/entities/profile";
import { selectUserId, useSessionStore } from "@/entities/session";
import { TIMING } from "@/shared/config/timings";
import { showFriendDesktopToast } from "@/shared/lib/friendToast";

function isPlayingStatus(status: string | null | undefined): boolean {
  return status === "in_game" || status === "hosting";
}

/**
 * When a friend flips into in_game / hosting, show a themed desktop toast
 * (separate always-on-top window, bottom-right of the screen).
 */
export function useFriendPlayToasts(): void {
  const userId = useSessionStore(selectUserId);
  const enabled = useSessionStore((s) => s.gate === "app" && !s.offlineMode);
  const themeId = useProfileStore((s) => s.profile.theme);
  const friendToasts = useProfileStore((s) => s.profile.friend_toasts);
  const prev = useRef(new Map<string, string>());
  const primed = useRef(false);

  useEffect(() => {
    if (!userId || !enabled || !friendToasts) {
      prev.current.clear();
      primed.current = false;
      return;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const rows = await listFriendships(userId);
        if (cancelled) return;
        if (!useProfileStore.getState().profile.friend_toasts) return;
        const profile = useProfileStore.getState().profile;
        for (const row of rows) {
          if (row.direction !== "friend") continue;
          const id = row.profile.id;
          const st = row.sessionStatus ?? "offline";
          const was = prev.current.get(id);
          if (
            primed.current &&
            isPlayingStatus(st) &&
            !isPlayingStatus(was)
          ) {
            void showFriendDesktopToast({
              title: row.profile.username || "Friend",
              kind: st === "hosting" ? "Hosting" : "Playing",
              detail: row.sessionPackName?.trim() || "Minecraft",
              skinUrl: row.profile.skin_path,
              themeId: profile.theme,
              themeCustom: profile.theme_custom,
            }).catch(() => undefined);
          }
          prev.current.set(id, st);
        }
        primed.current = true;
      } catch {
        /* quiet — friends poll must not toast errors */
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), TIMING.friendsPoll);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [userId, enabled, themeId, friendToasts]);
}
