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
import {
  encodeUnlimShareCode,
  unlimEnsureHost,
  unlimHostState,
  unlimStatus,
  unlimStopHost,
} from "@/shared/api/unlim";
import { toast } from "@/shared/lib/toast";
import { useRail } from "@/shared/lib/useRoute";
import { useGameStore } from "@/entities/game";
import { setStatus } from "@/entities/install";
import { useCurrentPackId } from "@/entities/pack";
import { useProfileStore } from "@/entities/profile";
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
 * While the game runs, watches for Open-to-LAN and publishes a share code.
 * - `network_mode=unlim`: shared Unlim host (voice ports + LAN).
 * - `network_mode=hybrid`: Steam Porthole for LAN only.
 */
export function useLanHosting(): void {
  const appActive = useSessionStore((s) => s.gate === "app");
  const phase = useGameStore((s) => s.phase);
  const runningPackId = useGameStore((s) => s.runningPackId);
  const currentPackId = useCurrentPackId(useRail());
  const packId = runningPackId ?? currentPackId;
  const networkMode = useProfileStore((s) => s.profile.network_mode);

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
        if (networkMode === "unlim") {
          if (!voiceBusy()) {
            void unlimStopHost().catch(() => undefined);
          }
        } else {
          void portholeStopHost().catch(() => undefined);
          if (!voiceBusy()) {
            void portholeStopAll().catch(() => undefined);
          }
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
                `LAN closed → tear tunnel (was port=${publishedPort()} mode=${networkMode})`,
              );
              game().setHostingLan(null);
              if (networkMode === "unlim") {
                if (!voiceBusy()) {
                  await unlimStopHost().catch(() => undefined);
                }
              } else {
                await portholeStopHost().catch(() => undefined);
              }
              if (!cancelled) toast(MSG.lan.hostingStopped);
            }
            return;
          }
          miss.current = 0;

          if (networkMode === "unlim") {
            const existing = game().hostingLan;
            // Already published this LAN — never reopen / re-toast every poll.
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

            const preferPort = useProfileStore.getState().profile.lan_port;
            const reservePort =
              typeof preferPort === "number" && preferPort > 0
                ? preferPort
                : port;
            const host = await unlimHostState().catch(() => null);
            const keyNow = host?.alive ? host.key?.trim() || null : null;
            const voiceLive = voiceBusy();
            // Voice already reserved LiveKit + LAN in one Unlim session — only
            // publish presence. Never ensure/restart (that drops voice guests).
            const reuseOnly =
              Boolean(keyNow) &&
              (voiceLive ||
                host?.lan_port === reservePort ||
                host?.lan_port === port);

            busy.current = true;
            if (!reuseOnly) {
              setStatus(MSG.lan.openingTunnel);
              void netLog(
                "ui",
                `opening Unlim shared host port=${port} reserve=${reservePort}`,
              );
            } else {
              void netLog(
                "ui",
                `Unlim reuse key=${keyNow} lan=${host?.lan_port ?? "-"} voice=${voiceLive ? 1 : 0} — publish LAN port=${port}`,
              );
            }
            try {
              const st = await unlimStatus();
              if (!st.installed) {
                throw new Error(MSG.voice.installUnlim);
              }

              let rawKey: string;
              if (reuseOnly && keyNow) {
                rawKey = keyNow;
              } else if (voiceLive) {
                // Voice is up but status briefly empty — do not rebuild Unlim.
                throw new Error(
                  "Voice is live but Unlim key is missing — wait a moment and open LAN again",
                );
              } else {
                rawKey = await unlimEnsureHost(reservePort);
              }

              const shareCode = encodeUnlimShareCode(rawKey);
              if (cancelled) return;
              fail.current = null;
              const prevCode = existing?.shareCode;
              game().setHostingLan({
                packId,
                shareCode,
                gamePort: port,
              });
              void netLog(
                "ui",
                `hosting Unlim pack=${packId} code=${shareCode} gamePort=${port} reused=${reuseOnly || prevCode === shareCode ? 1 : 0}`,
              );
              if (prevCode !== shareCode) toast(MSG.lan.hosting);
              if (!reuseOnly) setStatus("", "ok");
            } catch (err) {
              fail.current = { port, at: Date.now() };
              const msg =
                err instanceof Error ? err.message : MSG.lan.startFailed;
              void netLog("ui", `Unlim LAN FAILED: ${msg}`);
              if (!cancelled) setStatus(msg, "error");
            } finally {
              busy.current = false;
            }
            return;
          }

          // Hybrid: Steam Porthole for LAN.
          const live = await portholeCurrentHost().catch(() => null);
          const tunnelOk = live != null && Boolean(live.share_code);
          const liveLan =
            typeof live?.lan_port === "number" && live.lan_port > 0
              ? live.lan_port
              : null;
          const sameLan =
            live != null &&
            (live.port === port || liveLan === port) &&
            tunnelOk &&
            publishedPort() === port;
          if (sameLan) return;

          const lastHy = fail.current;
          if (
            lastHy &&
            lastHy.port === port &&
            Date.now() - lastHy.at < TIMING.lanHostRetryCooldown
          ) {
            return;
          }
          busy.current = true;
          setStatus(MSG.lan.openingTunnel);
          void netLog(
            "ui",
            `opening Porthole LAN port=${port} liveLan=${liveLan ?? "-"}`,
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
              `hosting Porthole pack=${packId} code=${shareCode} gamePort=${gamePort}`,
            );
            toast(MSG.lan.hosting);
            setStatus("", "ok");
          } catch (err) {
            fail.current = { port, at: Date.now() };
            const msg =
              err instanceof Error ? err.message : MSG.lan.startFailed;
            void netLog("ui", `tunnel FAILED: ${msg}`);
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
  }, [appActive, phase, packId, networkMode]);
}
