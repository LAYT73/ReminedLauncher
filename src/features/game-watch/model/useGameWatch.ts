import { useEffect, useRef } from "react";
import { MSG } from "@/shared/config/messages";
import { TIMING } from "@/shared/config/timings";
import { toast } from "@/shared/lib/toast";
import { gameApi, useGameStore, type GamePhase } from "@/entities/game";
import { usePlaytimeStore } from "@/entities/playtime";
import { useSessionStore } from "@/entities/session";

/**
 * Follows the game process: polls the phase, publishes the live world/server
 * chip from latest.log, and looks for a crash report when the game exits.
 */
export function useGameWatch(): void {
  const phase = useGameStore((s) => s.phase);
  const runningPackId = useGameStore((s) => s.runningPackId);
  const prevPhase = useRef<GamePhase>("idle");
  const launchAt = useRef(0);
  const sessionPackId = useRef<string | null>(null);
  /** Seconds already flushed to playtime for this process (avoid double-count). */
  const flushedSec = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      void gameApi
        .phase()
        .then(useGameStore.getState().setPhase)
        .catch(() => undefined);
    }, TIMING.gamePhasePoll);
    return () => window.clearInterval(id);
  }, []);

  // Track launch time + per-pack playtime + crash on running -> idle.
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;
    const game = useGameStore.getState();
    const session = useSessionStore.getState();
    const online = Boolean(session.session && !session.offlineMode);

    if (prev === "idle" && phase !== "idle") {
      launchAt.current = Date.now();
      flushedSec.current = 0;
      game.setCrash(null);
      const packId =
        game.lastLaunchedPackId ?? game.runningPackId ?? null;
      sessionPackId.current = packId;
    }

    if (prev !== "idle" && phase === "idle") {
      game.setLive(null);
      const packId =
        sessionPackId.current ??
        game.lastLaunchedPackId ??
        game.runningPackId ??
        null;
      const started = launchAt.current;
      const elapsedSec = started
        ? Math.max(0, Math.floor((Date.now() - started) / 1000))
        : 0;
      const add = Math.max(0, elapsedSec - flushedSec.current);
      // Flush any remaining time (even short sessions — UI needs last launch).
      if (online && packId && (add >= 15 || elapsedSec >= 15)) {
        void usePlaytimeStore.getState().record(packId, add > 0 ? add : 0);
      }
      flushedSec.current = 0;
      sessionPackId.current = null;

      const crashPack = game.lastLaunchedPackId;
      if (!crashPack) return;
      void gameApi
        .latestCrash(crashPack, launchAt.current)
        .then((info) => {
          if (!info) return;
          useGameStore.getState().setCrash(info);
          toast(MSG.launch.crashed(info.summary), "err");
        })
        .catch(() => undefined);
    }
  }, [phase]);

  // While running, periodically bank playtime so a crash/kill still counts.
  useEffect(() => {
    if (phase !== "running") return;
    const packId =
      sessionPackId.current ??
      useGameStore.getState().lastLaunchedPackId ??
      useGameStore.getState().runningPackId;
    if (!packId) return;
    const online = () => {
      const s = useSessionStore.getState();
      return Boolean(s.session && !s.offlineMode);
    };
    const id = window.setInterval(() => {
      if (!online()) return;
      const elapsed = Math.max(
        0,
        Math.floor((Date.now() - launchAt.current) / 1000),
      );
      const add = elapsed - flushedSec.current;
      if (add < 60) return;
      flushedSec.current = elapsed;
      void usePlaytimeStore.getState().record(packId, add);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [phase, runningPackId]);

  // Live game status chip from latest.log.
  useEffect(() => {
    if (phase !== "running") return;
    const packId = useGameStore.getState().lastLaunchedPackId;
    if (!packId) return;
    let stop = false;
    const tick = () =>
      void gameApi
        .liveStatus(packId)
        .then((s) => {
          if (!stop) useGameStore.getState().setLive(s);
        })
        .catch(() => undefined);
    tick();
    const id = window.setInterval(tick, TIMING.gameLivePoll);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [phase, runningPackId]);
}
