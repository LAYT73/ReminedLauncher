import { useEffect, useRef, useState } from "react";
import { netLog } from "@/shared/api/netLog";
import { TIMING } from "@/shared/config/timings";
import { useRail } from "@/shared/lib/useRoute";
import { useSharePrefs } from "@/shared/lib/sharePrefs";
import { useGameStore } from "@/entities/game";
import { useRailPackId, useActiveReminePack } from "@/entities/pack";
import { useProfileStore } from "@/entities/profile";
import { selectUserId, setPresence, useSessionStore } from "@/entities/session";
import { useVoiceStatusStore } from "@/entities/voice-room";

/**
 * Publishes friends-visible presence (online / in_game / hosting + voice) now
 * and every 40 s. Stays online while the main window is hidden to tray —
 * only goes offline on real unload / sign-out.
 */
export function usePresenceHeartbeat(): void {
  const userId = useSessionStore(selectUserId);
  const enabled = useSessionStore((s) => s.gate === "app" && !s.offlineMode);
  const phase = useGameStore((s) => s.phase);
  const hostingLan = useGameStore((s) => s.hostingLan);
  const runningPackId = useGameStore((s) => s.runningPackId);
  const shareActivity = useSharePrefs((s) => s.shareActivity);
  const liveActivity = useGameStore((s) =>
    shareActivity && s.phase === "running" ? s.live?.activity || null : null,
  );
  const [activity, setActivity] = useState<string | null>(null);
  const voiceInRoom = useVoiceStatusStore((s) => s.inRoom);
  const railPackId = useRailPackId(useRail());
  const activePackId = useActiveReminePack()?.id;
  const selectedPackId = useProfileStore((s) => s.profile.selected_pack);
  const playingPackId =
    (runningPackId ?? railPackId) ?? activePackId ?? (selectedPackId || null);
  // Debounce activity changes (~5 s) so quick menu flips don't spam the server;
  // first value and "stopped playing" apply immediately.
  useEffect(() => {
    if (liveActivity === null || activity === null) {
      setActivity(liveActivity);
      return;
    }
    const id = window.setTimeout(() => setActivity(liveActivity), 5_000);
    return () => window.clearTimeout(id);
  }, [liveActivity, activity]);

  /** Avoid spamming net log on every 40s heartbeat — only on change. */
  const lastHostLog = useRef<string>("");

  useEffect(() => {
    if (!userId || !enabled) return;

    const push = () => {
      if (hostingLan && phase !== "idle") {
        const key = `${hostingLan.shareCode}|${hostingLan.gamePort}|${hostingLan.packId}`;
        if (lastHostLog.current !== key) {
          lastHostLog.current = key;
          void netLog(
            "presence",
            `push hosting pack=${hostingLan.packId} code=${hostingLan.shareCode} port=${hostingLan.gamePort} voice=${voiceInRoom ? 1 : 0}`,
          );
        }
        void setPresence({
          userId,
          status: "hosting",
          packId: hostingLan.packId,
          shareCode: hostingLan.shareCode,
          gamePort: hostingLan.gamePort,
          inVoice: voiceInRoom,
          activity,
        });
        return;
      }
      if (lastHostLog.current) {
        lastHostLog.current = "";
        void netLog("presence", "push clear hosting");
      }
      const playing = phase === "running" || phase === "launching";
      void setPresence({
        userId,
        status: playing ? "in_game" : "online",
        packId: playing ? playingPackId : null,
        shareCode: null,
        gamePort: null,
        inVoice: voiceInRoom,
        activity: playing ? activity : null,
      });
    };
    push();
    const heartbeat = window.setInterval(push, TIMING.presenceHeartbeat);

    /** Real process teardown — not window.hide() to tray. */
    const goOffline = () => {
      void setPresence({ userId, status: "offline", packId: null });
    };
    window.addEventListener("pagehide", goOffline);
    window.addEventListener("beforeunload", goOffline);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", goOffline);
      window.removeEventListener("beforeunload", goOffline);
    };
  }, [userId, enabled, phase, hostingLan, voiceInRoom, playingPackId, activity]);

  // Offline on sign-out (gate leaves app) — not on window hide to tray.
  useEffect(() => {
    if (!userId || !enabled) return;
    return () => {
      void setPresence({ userId, status: "offline", packId: null });
    };
  }, [userId, enabled]);
}
