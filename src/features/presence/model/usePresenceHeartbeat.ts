import { useEffect } from "react";
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

  useEffect(() => {
    if (!userId || !enabled) return;

    const push = () => {
      if (hostingLan) {
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
