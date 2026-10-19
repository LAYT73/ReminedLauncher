import { useEffect, useRef } from "react";
import { MSG } from "@/shared/config/messages";
import { TIMING } from "@/shared/config/timings";
import {
  portholeStartHost,
  portholeStopAll,
  portholeStopHost,
  readLanPort,
} from "@/shared/api/porthole";
import { toast } from "@/shared/lib/toast";
import { useRail } from "@/shared/lib/useRoute";
import { useGameStore } from "@/entities/game";
import { setStatus } from "@/entities/install";
import { useCurrentPackId } from "@/entities/pack";
import { useSessionStore } from "@/entities/session";

/**
 * While the game runs, watches for Open-to-LAN, exposes the port through
 * Porthole and publishes a share code. Tears the tunnel down when LAN closes
 * or the game exits.
 */
export function useLanHosting(): void {
  const appActive = useSessionStore((s) => s.gate === "app");
  const phase = useGameStore((s) => s.phase);
  const runningPackId = useGameStore((s) => s.runningPackId);
  const currentPackId = useCurrentPackId(useRail());
  const packId = runningPackId ?? currentPackId;

  const busy = useRef(false);
  const fail = useRef<{ port: number; at: number } | null>(null);

  useEffect(() => {
    const game = useGameStore.getState;
    if (!appActive || phase !== "running" || !packId) {
      if (phase === "idle") {
        game().setRunningPackId(null);
        game().setHostingLan(null);
        busy.current = false;
        void portholeStopAll().catch(() => undefined);
      }
      return;
    }
    let cancelled = false;
    const publishedPort = () => game().hostingLan?.gamePort ?? null;

    const tick = window.setInterval(() => {
      void (async () => {
        if (cancelled || busy.current) return;
        try {
          const port = await readLanPort(packId);
          if (cancelled) return;

          // World left / LAN closed (log shows stop after publish) — tear down tunnel.
          if (!port) {
            if (publishedPort() !== null) {
              fail.current = null;
              game().setHostingLan(null);
              await portholeStopHost().catch(() => undefined);
              if (!cancelled) toast(MSG.lan.hostingStopped);
            }
            return;
          }

          if (publishedPort() === port) return;
          const last = fail.current;
          if (last && last.port === port && Date.now() - last.at < TIMING.lanHostRetryCooldown) {
            return;
          }
          busy.current = true;
          setStatus(MSG.lan.openingTunnel);
          try {
            if (publishedPort() && publishedPort() !== port) {
              await portholeStopHost();
            }
            const info = await portholeStartHost(port);
            if (cancelled) {
              await portholeStopHost();
              return;
            }
            fail.current = null;
            game().setHostingLan({
              packId,
              shareCode: info.share_code,
              gamePort: info.port,
            });
            toast(MSG.lan.hosting);
            setStatus("", "ok");
          } catch (err) {
            fail.current = { port, at: Date.now() };
            if (!cancelled) {
              setStatus(
                err instanceof Error ? err.message : MSG.lan.startFailed,
                "error",
              );
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
