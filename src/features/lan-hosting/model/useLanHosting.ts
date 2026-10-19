import { useEffect, useRef } from "react";
import { MSG } from "@/shared/config/messages";
import { TIMING } from "@/shared/config/timings";
import {
  portholeCurrentHost,
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
import {
  setVoiceRoomShareCode,
  useVoiceStatusStore,
} from "@/entities/voice-room";
import { voiceStartPorthole } from "@/features/voice/api/voiceNative";

/**
 * While the game runs, watches for Open-to-LAN, exposes the port through
 * Porthole and publishes a share code. Tears the tunnel down when LAN closes
 * or the game exits.
 *
 * Shares one Porthole host with voice: when the local user is a voice host,
 * LAN is merged into the voice lobby instead of replacing it.
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
        const hadLan = game().hostingLan != null;
        game().setRunningPackId(null);
        game().setHostingLan(null);
        busy.current = false;
        const voiceHost = useVoiceStatusStore.getState().hostRoomId;
        if (voiceHost && hadLan) {
          // Drop LAN backends; keep voice lobby (new share code → sync room).
          void voiceStartPorthole(null)
            .then(async (ready) => {
              await setVoiceRoomShareCode(voiceHost, ready.share_code).catch(
                () => undefined,
              );
            })
            .catch(() => undefined);
        } else if (!voiceHost) {
          void portholeStopAll().catch(() => undefined);
        }
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
              const voiceHost = useVoiceStatusStore.getState().hostRoomId;
              if (voiceHost) {
                // Drop LAN from the lobby; keep voice expose.
                const ready = await voiceStartPorthole(null).catch(() => null);
                if (ready?.share_code) {
                  await setVoiceRoomShareCode(voiceHost, ready.share_code).catch(
                    () => undefined,
                  );
                }
              } else {
                await portholeStopHost().catch(() => undefined);
              }
              if (!cancelled) toast(MSG.lan.hostingStopped);
            }
            return;
          }

          const voiceHost = useVoiceStatusStore.getState().hostRoomId;
          const live = await portholeCurrentHost().catch(() => null);
          // When voice+LAN share a lobby, primary port is LiveKit 7880 — still OK if code exists.
          const tunnelOk = live != null && Boolean(live.share_code);
          const sameLanAlone =
            !voiceHost && live != null && live.port === port && tunnelOk;
          const sameMerged =
            Boolean(voiceHost) &&
            tunnelOk &&
            publishedPort() === port &&
            Boolean(game().hostingLan?.shareCode);
          if (sameLanAlone || sameMerged) return;

          const last = fail.current;
          if (last && last.port === port && Date.now() - last.at < TIMING.lanHostRetryCooldown) {
            return;
          }
          busy.current = true;
          setStatus(MSG.lan.openingTunnel);
          try {
            let shareCode: string;
            let gamePort = port;
            if (voiceHost) {
              const ready = await voiceStartPorthole(port);
              shareCode = ready.share_code;
              gamePort = port;
              await setVoiceRoomShareCode(voiceHost, shareCode).catch(
                () => undefined,
              );
            } else {
              if (live && live.port !== port) {
                await portholeStopHost();
              }
              const info = await portholeStartHost(port);
              shareCode = info.share_code;
              gamePort = info.port;
            }
            if (cancelled) {
              if (!voiceHost) await portholeStopHost();
              return;
            }
            fail.current = null;
            game().setHostingLan({
              packId,
              shareCode,
              gamePort,
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
