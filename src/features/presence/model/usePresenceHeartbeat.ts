import { useEffect, useRef } from "react";
import { netLog } from "@/shared/api/netLog";
import { TIMING } from "@/shared/config/timings";
import { useRail } from "@/shared/lib/useRoute";
import { useGameStore } from "@/entities/game";
import { useRailPackId, useActiveReminePack } from "@/entities/pack";
import { useProfileStore } from "@/entities/profile";
import { selectUserId, setPresence, useSessionStore } from "@/entities/session";
import { useVoiceStatusStore } from "@/entities/voice-room";

/**
 * Publishes friends-visible presence (online / in_game / hosting + voice) now
 * and every 40 s, and marks the user offline on page hide / unmount.
 */
export function usePresenceHeartbeat(): void {
  const userId = useSessionStore(selectUserId);
  const enabled = useSessionStore((s) => s.gate === "app" && !s.offlineMode);
  const phase = useGameStore((s) => s.phase);
  const hostingLan = useGameStore((s) => s.hostingLan);
  const runningPackId = useGameStore((s) => s.runningPackId);
  const voiceInRoom = useVoiceStatusStore((s) => s.inRoom);
  const railPackId = useRailPackId(useRail());
  const activePackId = useActiveReminePack()?.id;
  const selectedPackId = useProfileStore((s) => s.profile.selected_pack);
  const playingPackId =
    (runningPackId ?? railPackId) ?? activePackId ?? (selectedPackId || null);
  /** Avoid spamming net log on every 40s heartbeat — only on change. */
  const lastHostLog = useRef<string>("");

  useEffect(() => {
    if (!userId || !enabled) return;

    const push = () => {
      if (hostingLan) {
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
      });
    };
    push();
    const heartbeat = window.setInterval(push, TIMING.presenceHeartbeat);

    const goOffline = () => {
      void setPresence({ userId, status: "offline", packId: null });
    };
    window.addEventListener("pagehide", goOffline);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", goOffline);
    };
  }, [userId, enabled, phase, hostingLan, voiceInRoom, playingPackId]);

  // Offline on sign-out / unmount.
  useEffect(() => {
    if (!userId || !enabled) return;
    return () => {
      void setPresence({ userId, status: "offline", packId: null });
    };
  }, [userId, enabled]);
}
