import { useEffect, useRef } from "react";
import { listFriendships, useFriendBadgeStore } from "@/entities/friend";
import { sendGameNotifyWithHead } from "@/entities/skin";
import { useGameStore } from "@/entities/game";
import { usePartyStore } from "@/entities/voice-room";
import { useProfileStore } from "@/entities/profile";
import { selectUserId, useSessionStore } from "@/entities/session";
import { getLocale, t } from "@/shared/i18n";
import { TIMING } from "@/shared/config/timings";
import { netLog } from "@/shared/api/netLog";
import { showFriendDesktopToast } from "@/shared/lib/friendToast";
import { notifySystem } from "@/shared/lib/systemNotify";
import { useGameBridgePrefs } from "@/shared/lib/gameBridgePrefs";
import { useGameBridgeStore } from "@/shared/lib/gameBridgeStore";
import { toast } from "@/shared/lib/toast";

function isPlayingStatus(status: string | null | undefined): boolean {
  return status === "in_game" || status === "hosting";
}

/**
 * Heartbeats can lapse while the launcher is backgrounded or the friend's row goes stale.
 * A friend seen playing within this window is not "newly" playing again.
 */
const RECENT_PLAY_MS = 5 * 60_000;

/**
 * When a friend flips into in_game / hosting, show a themed desktop toast
 * (separate always-on-top window, bottom-right of the screen). While the
 * in-game companion is connected, toasts go into the game instead, and a
 * friend hosting the running pack gets an invite the mod can accept with a key.
 */
export function useFriendPlayToasts(): void {
  const userId = useSessionStore(selectUserId);
  const enabled = useSessionStore((s) => s.gate === "app" && !s.offlineMode);
  const themeId = useProfileStore((s) => s.profile.theme);
  const prev = useRef(new Map<string, string>());
  const primed = useRef(false);
  const prevIncoming = useRef(new Set<string>());
  const incomingPrimed = useRef(false);
  /** Last tick each friend was seen in_game / hosting (gap tolerance for toasts and invites). */
  const lastSeenPlayingAt = useRef(new Map<string, number>());
  const lastSeenHostingAt = useRef(new Map<string, number>());

  useEffect(() => {
    if (!userId || !enabled) {
      prev.current.clear();
      primed.current = false;
      prevIncoming.current.clear();
      incomingPrimed.current = false;
      lastSeenPlayingAt.current.clear();
      lastSeenHostingAt.current.clear();
      useFriendBadgeStore.getState().reset();
      return;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const rows = await listFriendships(userId);
        if (cancelled) return;
        useFriendBadgeStore.getState().setFromRows(rows);
        const bridge = useGameBridgeStore.getState().connected;
        const inGame = bridge && useGameBridgePrefs.getState().notifications;
        const incomingNow = new Set<string>();
        for (const row of rows) {
          if (row.direction !== "incoming") continue;
          incomingNow.add(row.friendshipId);
          if (incomingPrimed.current && inGame && !prevIncoming.current.has(row.friendshipId)) {
            sendGameNotifyWithHead(
              {
                kind: "request",
                title: t("social.inGame.friendRequest"),
                body: row.profile.username || t("social.presence.friendFallback"),
              },
              { userId: row.profile.id, skinUrl: row.profile.skin_path },
            );
          }
          if (incomingPrimed.current && !prevIncoming.current.has(row.friendshipId)) {
            void notifySystem(
              t("shell.notify.friendRequest.title"),
              t("shell.notify.friendRequest.body", {
                name: row.profile.username || t("social.presence.friendFallback"),
              }),
            );
          }
        }
        prevIncoming.current = incomingNow;
        incomingPrimed.current = true;
        if (!useProfileStore.getState().profile.friend_toasts) {
          prev.current.clear();
          primed.current = false;
          lastSeenPlayingAt.current.clear();
          lastSeenHostingAt.current.clear();
          return;
        }
        const profile = useProfileStore.getState().profile;
        for (const row of rows) {
          if (row.direction !== "friend") continue;
          const id = row.profile.id;
          const st = row.sessionStatus ?? "offline";
          const was = prev.current.get(id);
          const now = Date.now();
          const recentlyPlaying =
            now - (lastSeenPlayingAt.current.get(id) ?? -Infinity) < RECENT_PLAY_MS;
          const recentlyHosting =
            now - (lastSeenHostingAt.current.get(id) ?? -Infinity) < RECENT_PLAY_MS;
          if (isPlayingStatus(st)) lastSeenPlayingAt.current.set(id, now);
          if (st === "hosting") lastSeenHostingAt.current.set(id, now);
          // A party member hosting: the party's own join prompt (usePartyWorldWatch) is the single source.
          const party = usePartyStore.getState();
          const hostingInMyParty =
            st === "hosting" && Boolean(party.room) && party.members.some((m) => m.userId === id);
          const title =
            row.profile.username || t("social.presence.friendFallback");
          const kind =
            st === "hosting"
              ? t("social.presence.hosting")
              : t("social.presence.playing");
          const detail = row.sessionPackName?.trim() || "Minecraft";
          const runningPack = useGameStore.getState().runningPackId;
          let invited = false;
          if (
            primed.current &&
            inGame &&
            st === "hosting" &&
            !hostingInMyParty &&
            was !== "hosting" &&
            !recentlyHosting &&
            runningPack &&
            row.sessionPackId === runningPack
          ) {
            // Invite = one notify with a join action; the mod draws its own join chip + timer.
            const inviteBody = t("social.inGame.inviteBody");
            sendGameNotifyWithHead(
              {
                kind: "invite",
                title,
                body: row.sessionPackName?.trim()
                  ? `${inviteBody} · ${row.sessionPackName.trim()}`
                  : inviteBody,
                action: { type: "join", id, ttl: 15000 },
              },
              { userId: id, skinUrl: row.profile.skin_path },
            );
            invited = true;
          }
          if (
            primed.current &&
            isPlayingStatus(st) &&
            !isPlayingStatus(was) &&
            !recentlyPlaying &&
            !hostingInMyParty
          ) {
            if (inGame) {
              // The invite notify above already covers this hosting start.
              if (!invited)
                sendGameNotifyWithHead(
                  { kind: "friend", title, body: `${kind} · ${detail}` },
                  { userId: id, skinUrl: row.profile.skin_path },
                );
              prev.current.set(id, st);
              continue;
            }
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
              toast(t("social.presence.toastFallback", { title, kind, detail }));
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
