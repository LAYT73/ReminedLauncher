import { useEffect, useRef } from "react";
import { MSG } from "@/shared/config/messages";
import { TIMING } from "@/shared/config/timings";
import { netLog } from "@/shared/api/netLog";
import {
  encodeRelayShareCode,
  relayAttachLan,
  relayDetachLan,
  relayEnsureHost,
  relayHostState,
  relayStatus,
  relayStopHost,
} from "@/shared/api/relay";
import { setVoiceRoomShareCode } from "@/entities/voice-room";
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

function voiceBusy(): boolean {
  const v = useVoiceStatusStore.getState();
  return Boolean(v.hostRoomId || v.inRoom);
}

/**
 * While the game runs, watches for Open-to-LAN and publishes a Remined Relay
 * share code. LAN attaches hot onto a live voice session (no voice reconnect).
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
        game().setRunningPackId(null);
        game().setHostingLan(null);
        busy.current = false;
        miss.current = 0;
        if (!voiceBusy()) {
          void relayStopHost().catch(() => undefined);
        }
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
              if (voiceBusy()) {
                const nextKey = await relayDetachLan().catch(() => null);
                const roomId = useVoiceStatusStore.getState().hostRoomId;
                if (nextKey && roomId) {
                  await setVoiceRoomShareCode(roomId, nextKey).catch(
                    () => undefined,
                  );
                }
              } else {
                await relayStopHost().catch(() => undefined);
              }
              if (!cancelled) toast(MSG.lan.hostingStopped);
            }
            return;
          }
          miss.current = 0;

          const existing = game().hostingLan;
          if (existing && existing.gamePort === port) {
            return;
          }

          const last = fail.current;
          if (
            last &&
            last.port === port &&
            Date.now() - last.at < TIMING.lanHostRetryCooldown
          ) {
            return;
          }

          const host = await relayHostState().catch(() => null);
          const keyNow = host?.alive ? host.key?.trim() || null : null;
          const voiceLive = voiceBusy();
          const alreadyAttached = Boolean(keyNow) && host?.lan_port === port;

          busy.current = true;
          if (!alreadyAttached) {
            setStatus(MSG.lan.openingTunnel);
            void netLog(
              "ui",
              `Relay LAN attach port=${port} voice=${voiceLive ? 1 : 0} key=${keyNow ? "yes" : "no"}`,
            );
          } else {
            void netLog(
              "ui",
              `Relay LAN already attached port=${port} — publish presence`,
            );
          }
          try {
            const st = await relayStatus();
            if (!st.installed) {
              throw new Error(MSG.voice.installRelay);
            }

            let rawKey: string;
            if (alreadyAttached && keyNow) {
              rawKey = keyNow;
            } else if (voiceLive || keyNow) {
              if (!keyNow && voiceLive) {
                throw new Error(
                  "Voice is live but Relay key is missing — wait a moment and open LAN again",
                );
              }
              rawKey = await relayAttachLan(port);
            } else {
              rawKey = await relayEnsureHost(port);
            }

            const shareCode = encodeRelayShareCode(rawKey);
            if (cancelled) return;
            fail.current = null;
            const prevCode = existing?.shareCode;
            game().setHostingLan({
              packId,
              shareCode,
              gamePort: port,
            });
            const roomId = useVoiceStatusStore.getState().hostRoomId;
            if (roomId && prevCode !== shareCode) {
              await setVoiceRoomShareCode(roomId, rawKey).catch(() => undefined);
            }
            void netLog(
              "ui",
              `hosting Relay pack=${packId} code=${shareCode} gamePort=${port} hot=${voiceLive || alreadyAttached ? 1 : 0}`,
            );
            if (prevCode !== shareCode) toast(MSG.lan.hosting);
            if (!alreadyAttached) setStatus("", "ok");
          } catch (err) {
            fail.current = { port, at: Date.now() };
            const msg =
              err instanceof Error ? err.message : MSG.lan.startFailed;
            void netLog("ui", `Relay LAN FAILED: ${msg}`);
            if (!cancelled) setStatus(msg, "error");
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
