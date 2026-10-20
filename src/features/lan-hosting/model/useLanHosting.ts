import { useEffect, useRef } from "react";
import { MSG } from "@/shared/config/messages";
import { TIMING } from "@/shared/config/timings";
import { netLog } from "@/shared/api/netLog";
import {
  portholeCurrentHost,
  portholeStartHost,
  portholeStopAll,
  portholeStopHost,
} from "@/shared/api/porthole";
import { toast } from "@/shared/lib/toast";
import { useRail } from "@/shared/lib/useRoute";
import { useGameStore } from "@/entities/game";
import { setStatus } from "@/entities/install";
import { useCurrentPackId } from "@/entities/pack";
import { useSessionStore } from "@/entities/session";
import { useVoiceStatusStore } from "@/entities/voice-room";

/** Only trust tray-parsed LAN (session-bounded). Never raw log archaeology. */
function liveLanPort(): number | null {
  const live = useGameStore.getState().live;
  if (!live || live.phase !== "lan") return null;
  const port = live.lan_port;
  return typeof port === "number" && port > 0 ? port : null;
}

/**
 * While the game runs, watches for Open-to-LAN, exposes the port through
 * Porthole and publishes a share code. Tears the tunnel down when LAN closes
 * or the game exits.
 *
 * With an active voice host: rebuild one shared Voice+LAN lobby and publish the
 * new share code so guests auto-reconnect.
 */
export function useLanHosting(): void {
  const appActive = useSessionStore((s) => s.gate === "app");
  const phase = useGameStore((s) => s.phase);
  const runningPackId = useGameStore((s) => s.runningPackId);
  const currentPackId = useCurrentPackId(useRail());
  const packId = runningPackId ?? currentPackId;

  const busy = useRef(false);
  const fail = useRef<{ port: number; at: number } | null>(null);
  /** Consecutive empty LAN-port polls before we tear the tunnel down. */
  const miss = useRef(0);

  useEffect(() => {
    const game = useGameStore.getState;
    if (!appActive || phase !== "running" || !packId) {
      if (phase === "idle") {
        const hadLan = game().hostingLan != null;
        game().setRunningPackId(null);
        game().setHostingLan(null);
        busy.current = false;
        miss.current = 0;
        // Voice uses Unlim — only tear Porthole LAN when the game exits.
        void portholeStopHost().catch(() => undefined);
        if (
          !useVoiceStatusStore.getState().hostRoomId &&
          !useVoiceStatusStore.getState().inRoom
        ) {
          void portholeStopAll().catch(() => undefined);
        }
        void hadLan;
      }
      return;
    }
    let cancelled = false;
    const publishedPort = () => game().hostingLan?.gamePort ?? null;
    const MISS_BEFORE_DROP = 3;

    const tick = window.setInterval(() => {
      void (async () => {
        if (cancelled || busy.current) return;
        try {
          // gamewatch live status resets on "Setting user:" — unlike the old
          // reverse log scan that resurrected yesterday's Open-to-LAN.
          const port = liveLanPort();
          if (cancelled) return;

          if (!port) {
            if (publishedPort() !== null) {
              miss.current += 1;
              if (miss.current < MISS_BEFORE_DROP) return;
              miss.current = 0;
              fail.current = null;
              void netLog(
                "ui",
                `LAN closed → tear tunnel (was port=${publishedPort()})`,
              );
              game().setHostingLan(null);
              await portholeStopHost().catch(() => undefined);
              if (!cancelled) toast(MSG.lan.hostingStopped);
            }
            return;
          }
          miss.current = 0;

          const live = await portholeCurrentHost().catch(() => null);
          const tunnelOk = live != null && Boolean(live.share_code);
          const liveLan =
            typeof live?.lan_port === "number" && live.lan_port > 0
              ? live.lan_port
              : null;
          // Voice is on Unlim — LAN is always a standalone Porthole expose.
          const sameLan =
            live != null &&
            (live.port === port || liveLan === port) &&
            tunnelOk &&
            publishedPort() === port;
          if (sameLan) return;

          const last = fail.current;
          if (
            last &&
            last.port === port &&
            Date.now() - last.at < TIMING.lanHostRetryCooldown
          ) {
            return;
          }
          busy.current = true;
          setStatus(MSG.lan.openingTunnel);
          void netLog(
            "ui",
            `opening tunnel port=${port} (Porthole LAN; voice stays on Unlim) liveLan=${liveLan ?? "-"}`,
          );
          try {
            if (live && live.port !== port && liveLan !== port) {
              await portholeStopHost();
            }
            const info = await portholeStartHost(port);
            const shareCode = info.share_code;
            const gamePort = info.port;
            if (cancelled) {
              await portholeStopHost();
              return;
            }
            fail.current = null;
            game().setHostingLan({
              packId,
              shareCode,
              gamePort,
            });
            void netLog(
              "ui",
              `hosting set pack=${packId} code=${shareCode} gamePort=${gamePort}`,
            );
            toast(MSG.lan.hosting);
            setStatus("", "ok");
          } catch (err) {
            fail.current = { port, at: Date.now() };
            const msg =
              err instanceof Error ? err.message : MSG.lan.startFailed;
            void netLog("ui", `tunnel FAILED: ${msg}`);
            if (!cancelled) {
              setStatus(msg, "error");
            }
          } finally {
            busy.current = false;
          }
        } catch {
          /* keep polling */
        }
      })();
    }, TIMING.lanPoll);

    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [appActive, phase, packId]);
}
