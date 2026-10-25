import { useEffect, useRef } from "react";
import { useGameStore } from "@/entities/game";
import { usePackStore } from "@/entities/pack";
import {
  setMyMemberState,
  setPartyGameState,
  type PartyGameState,
  type PartyMemberState,
  type VoiceRoom,
} from "@/entities/voice-room";
import { TIMING } from "@/shared/config/timings";
import {
  deriveHostWorld,
  deriveMemberState,
  type PartyGameSnapshot,
} from "../lib/partyState";
import { usePartyJoinStore } from "./partyJoin";
import { usePartyInstall } from "./usePartyInstall";

type HostWant = { roomId: string; gameState: PartyGameState; lanPort: number | null };
type MemberWant = { roomId: string; state: PartyMemberState; progress: number | null };
type MemberHave = MemberWant & { at: number };

/** Delay before retry `attempt` (0-based): 2s, 4s, 8s … capped at 30s. */
export function partyRetryDelay(attempt: number): number {
  return Math.min(TIMING.partyRetryMax, TIMING.partyRetryMin * 2 ** attempt);
}

function sameHost(a: HostWant | null, b: HostWant | null): boolean {
  return Boolean(a && b && a.roomId === b.roomId && a.gameState === b.gameState && a.lanPort === b.lanPort);
}

function sameMember(a: MemberWant | null, b: MemberWant | null): boolean {
  return Boolean(a && b && a.roomId === b.roomId && a.state === b.state && a.progress === b.progress);
}

/**
 * Publishes this client's party state. The host writes room.game_state/lan_port,
 * every member writes its own state (progress throttled to one write per
 * TIMING.partyProgressThrottle) and re-writes it every TIMING.partyHeartbeat so
 * updated_at stays fresh. Confirmed state only advances after a successful write;
 * failures retry with backoff against whatever is desired at that moment.
 */
export function usePartyPublisher(opts: {
  room: VoiceRoom | null;
  userId: string;
  isHost: boolean;
}): void {
  const { room, userId, isHost } = opts;
  const roomId = room?.id ?? null;
  const packId = room?.packId ?? null;

  const phase = useGameStore((s) => s.phase);
  const runningPackId = useGameStore((s) => s.runningPackId);
  const lastLaunchedPackId = useGameStore((s) => s.lastLaunchedPackId);
  const live = useGameStore((s) => s.live);
  const hostingLanPort = useGameStore((s) => s.hostingLan?.gamePort ?? null);
  const installed = usePackStore((s) => (packId ? s.installedIds.has(packId) : false));
  const { installing, percent } = usePartyInstall(packId, installed);
  const joinedRoomId = usePartyJoinStore((s) => s.joinedRoomId);

  const game: PartyGameSnapshot = { phase, runningPackId, lastLaunchedPackId, live, hostingLanPort };

  // Leaving the game means no longer "in the host's world".
  useEffect(() => {
    if (phase === "idle" && usePartyJoinStore.getState().joinedRoomId) {
      usePartyJoinStore.getState().setJoinedRoomId(null);
    }
  }, [phase]);

  // Write channel state: desired (want), last confirmed (have), in-flight, retry.
  const hostWant = useRef<HostWant | null>(null);
  const hostHave = useRef<HostWant | null>(null);
  const hostInFlight = useRef(false);
  const memberWant = useRef<MemberWant | null>(null);
  const memberHave = useRef<MemberHave | null>(null);
  const memberInFlight = useRef(false);
  const timer = useRef<number | null>(null);
  const attempt = useRef(0);

  const clearTimer = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const later = (ms: number) => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      syncHost();
      syncMember();
    }, ms);
  };
  const retryLater = () => later(partyRetryDelay(attempt.current++));

  function syncHost(): void {
    const want = hostWant.current;
    if (!want || hostInFlight.current || sameHost(want, hostHave.current)) return;
    hostInFlight.current = true;
    void setPartyGameState(want.roomId, want.gameState, want.lanPort)
      .then(() => {
        hostInFlight.current = false;
        hostHave.current = want;
        attempt.current = 0;
        syncHost();
      })
      .catch(() => {
        hostInFlight.current = false;
        retryLater();
      });
  }

  function syncMember(): void {
    const want = memberWant.current;
    if (!want || memberInFlight.current || sameMember(want, memberHave.current)) return;
    const have = memberHave.current;
    if (have && have.roomId === want.roomId && have.state === want.state) {
      // Progress-only change: throttle to one write per window.
      const wait = TIMING.partyProgressThrottle - (Date.now() - have.at);
      if (wait > 0) {
        later(wait);
        return;
      }
    }
    memberInFlight.current = true;
    void setMyMemberState(want.roomId, userId, want.state, want.progress)
      .then(() => {
        memberInFlight.current = false;
        memberHave.current = { ...want, at: Date.now() };
        attempt.current = 0;
        syncMember();
      })
      .catch(() => {
        memberInFlight.current = false;
        retryLater();
      });
  }

  // Room change / leave: forget confirmed state, cancel pending retries, drop the join marker.
  useEffect(() => {
    hostHave.current = null;
    memberHave.current = null;
    attempt.current = 0;
    const join = usePartyJoinStore.getState();
    if (join.joinedRoomId && join.joinedRoomId !== roomId) join.setJoinedRoomId(null);
    return () => clearTimer();
    // Keyed on the room only; clearTimer/syncs read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Host: room-level world state (idle / launching / in_world / open + LAN port).
  const hostWorld = room && isHost && packId ? deriveHostWorld(game, packId) : null;
  const hostState = hostWorld?.gameState ?? null;
  const hostLanPort = hostWorld?.lanPort ?? null;
  useEffect(() => {
    hostWant.current =
      roomId && isHost && hostState ? { roomId, gameState: hostState, lanPort: hostLanPort } : null;
    // `room` is read for the no-op check only; realtime echoes must not re-trigger writes.
    const want = hostWant.current;
    if (want && room && room.gameState === want.gameState && room.lanPort === want.lanPort) {
      hostHave.current = want;
    }
    syncHost();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, isHost, hostState, hostLanPort]);

  // Every member: own state (+ install progress while installing the party pack).
  const member = room
    ? deriveMemberState({
        room,
        isHost,
        game,
        installed,
        installing,
        percent,
        joinedRoomId,
      })
    : null;
  const memberState = member?.state ?? null;
  const memberProgress = member?.progress ?? null;
  useEffect(() => {
    memberWant.current =
      roomId && memberState ? { roomId, state: memberState, progress: memberProgress } : null;
    syncMember();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId, memberState, memberProgress]);

  // Heartbeat: re-write the current member state so updated_at stays fresh (host included).
  useEffect(() => {
    if (!roomId) return;
    const id = window.setInterval(() => {
      const want = memberWant.current;
      if (!want || want.roomId !== roomId || memberInFlight.current) return;
      void setMyMemberState(want.roomId, userId, want.state, want.progress)
        .then(() => {
          memberHave.current = { ...want, at: Date.now() };
        })
        .catch(() => undefined);
    }, TIMING.partyHeartbeat);
    return () => window.clearInterval(id);
  }, [roomId, userId]);
}
