import { useEffect, useRef } from "react";
import { listFriendships, useFriendBadgeStore } from "@/entities/friend";
import { useProfileStore } from "@/entities/profile";
import { selectUserId, useSessionStore } from "@/entities/session";
import { getLocale, t } from "@/shared/i18n";
import { TIMING } from "@/shared/config/timings";
import { netLog } from "@/shared/api/netLog";
import { showFriendDesktopToast } from "@/shared/lib/friendToast";
import { toast } from "@/shared/lib/toast";

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
  const prev = useRef(new Map<string, string>());
  const primed = useRef(false);

  useEffect(() => {
    if (!userId || !enabled) {
      prev.current.clear();
      primed.current = false;
      useFriendBadgeStore.getState().reset();
      return;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const rows = await listFriendships(userId);
        if (cancelled) return;
        useFriendBadgeStore.getState().setFromRows(rows);
        if (!useProfileStore.getState().profile.friend_toasts) {
          prev.current.clear();
          primed.current = false;
          return;
        }
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
            const title =
              row.profile.username || t("social.presence.friendFallback");
            const kind =
              st === "hosting"
                ? t("social.presence.hosting")
                : t("social.presence.playing");
            const detail = row.sessionPackName?.trim() || "Minecraft";
            void showFriendDesktopToast({
              title,
              kind,
              detail,
              skinUrl: row.profile.skin_path,
              themeId: profile.theme,
              themeCustom: profile.theme_custom,
              locale: getLocale(),
            }).catch((e) => {
              void netLog("friend-toast", `desktop toast failed: ${String(e)}`);
              toast(`${title} — ${kind} ${detail}`);
            });
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
  }, [userId, enabled, themeId]);
}
