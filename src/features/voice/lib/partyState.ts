import type { GameLiveStatus, GamePhase } from "@/entities/game";
import type {
  PartyGameState,
  PartyMemberState,
  VoiceMember,
  VoiceRoom,
} from "@/entities/voice-room";
import { TIMING } from "@/shared/config/timings";

/** Slice of the game store the party state machine reads. */
export type PartyGameSnapshot = {
  phase: GamePhase;
  runningPackId: string | null;
  lastLaunchedPackId: string | null;
  live: GameLiveStatus | null;
  /** Port the relay tunnel is attached to (useGameStore.hostingLan), null until attached. */
  hostingLanPort: number | null;
};

/** Server clock may differ from ours by this much before the server timestamp alone decides. */
const CLOCK_SKEW_MARGIN_MS = 10 * 60_000;

/** First local time each (member, updated_at) pair was seen; immune to client clock skew. */
const firstSeen = new Map<string, number>();

/** A member row not written for this long (heartbeat missed): treated as joined / host offline. */
export function isMemberStale(
  m: Pick<VoiceMember, "userId" | "updatedAt">,
  now: number = Date.now(),
): boolean {
  if (!m.updatedAt) return false;
  const key = `${m.userId}|${m.updatedAt}`;
  let seen = firstSeen.get(key);
  if (seen === undefined) {
    seen = now;
    if (firstSeen.size > 500) firstSeen.clear();
    firstSeen.set(key, seen);
  }
  if (now - seen > TIMING.partyStaleAfter) return true;
  const at = Date.parse(m.updatedAt);
  return Number.isFinite(at) && now - at > TIMING.partyStaleAfter + CLOCK_SKEW_MARGIN_MS;
}

/** State a viewer should see for a member: stale rows count as plain "joined". */
export function effectiveMemberState(m: VoiceMember, now: number = Date.now()): PartyMemberState {
  return isMemberStale(m, now) ? "joined" : m.state;
}

/** Friend-safe activity base: "sp|nether|paused" → "sp", "" → "". */
export function activityBase(live: GameLiveStatus | null): string {
  return (live?.activity ?? "").split("|")[0] ?? "";
}

/** True while the game process is up for the party pack (launching or running). */
export function gameOnPartyPack(game: PartyGameSnapshot, packId: string): boolean {
  if (game.phase === "launching") return game.lastLaunchedPackId === packId;
  if (game.phase === "running") return game.runningPackId === packId;
  return false;
}

/**
 * Host side of the party: what the room row should say about the host's world.
 * idle → nothing running for the party; launching → game up, no world yet;
 * in_world → singleplayer world loaded; open → LAN published on lan_port.
 */
export function deriveHostWorld(
  game: PartyGameSnapshot,
  packId: string,
): { gameState: PartyGameState; lanPort: number | null } {
  if (!gameOnPartyPack(game, packId)) return { gameState: "idle", lanPort: null };
  if (game.phase === "launching") return { gameState: "launching", lanPort: null };
  const live = game.live;
  // 'open' only once the relay tunnel for this port exists; guests could not join before that.
  if (
    live?.phase === "lan" &&
    live.lan_port &&
    live.lan_port > 0 &&
    game.hostingLanPort === live.lan_port
  ) {
    return { gameState: "open", lanPort: live.lan_port };
  }
  const base = activityBase(live);
  if (base === "sp" || base === "lan") return { gameState: "in_world", lanPort: null };
  return { gameState: "launching", lanPort: null };
}

type MemberInputs = {
  room: VoiceRoom;
  isHost: boolean;
  game: PartyGameSnapshot;
  /** Party pack is on disk. */
  installed: boolean;
  /** The party pack is being installed or prepared right now. */
  installing: boolean;
  /** Install percent of the party pack; null when the install is for another pack or unknown. */
  percent: number | null;
  /** Room whose world this client joined through the party (null otherwise). */
  joinedRoomId: string | null;
  /** Host's member row is stale (heartbeat missed): guests treat the room as idle. */
  hostStale?: boolean;
};

/** What this client publishes as its own member state. */
export function deriveMemberState(
  m: MemberInputs,
): { state: PartyMemberState; progress: number | null } {
  const packId = m.room.packId;
  if (!packId) return { state: "joined", progress: null };
  // Install first: a join-triggered install already has lastLaunchedPackId set.
  if (!m.installed && m.installing) {
    return { state: "installing", progress: m.percent == null ? null : clampPercent(m.percent) };
  }
  if (gameOnPartyPack(m.game, packId)) {
    if (m.isHost) {
      const world = deriveHostWorld(m.game, packId).gameState;
      return { state: world === "in_world" || world === "open" ? "in_world" : "in_game", progress: null };
    }
    const inHost =
      m.joinedRoomId === m.room.id && activityBase(m.game.live) === "mp";
    return { state: inHost ? "in_world" : "in_game", progress: null };
  }
  if (m.installed) return { state: "ready", progress: null };
  return { state: "joined", progress: null };
}

function clampPercent(p: number): number {
  return Math.max(0, Math.min(100, Math.round(p)));
}

/** The one button the viewer sees, with the reason it is (or is not) enabled. */
export type PartyPrimary =
  | { kind: "legacy"; host: boolean }
  | { kind: "play" }
  | { kind: "busyOther" }
  | { kind: "starting" }
  | { kind: "hostLaunching" }
  | { kind: "hostWorld"; open: boolean }
  | { kind: "waitHost" }
  | { kind: "hostOffline" }
  | { kind: "install"; progress: number | null; installing: boolean }
  | { kind: "join" }
  | { kind: "inWorld" };

export function derivePrimary(m: MemberInputs): PartyPrimary {
  const packId = m.room.packId;
  if (!packId) return { kind: "legacy", host: m.isHost };
  const onParty = gameOnPartyPack(m.game, packId);
  const otherGame = m.game.phase !== "idle" && !onParty;

  if (m.isHost) {
    if (otherGame) return { kind: "busyOther" };
    if (m.game.phase === "launching") return { kind: "starting" };
    if (m.game.phase === "idle") return { kind: "play" };
    const world = deriveHostWorld(m.game, packId).gameState;
    if (world === "open") return { kind: "hostWorld", open: true };
    if (world === "in_world") return { kind: "hostWorld", open: false };
    return { kind: "hostLaunching" };
  }

  const inHost = m.joinedRoomId === m.room.id && onParty && activityBase(m.game.live) === "mp";
  if (inHost) return { kind: "inWorld" };
  if (otherGame) return { kind: "busyOther" };
  if (m.hostStale) return { kind: "hostOffline" };
  // Install (also the install a join triggers while the game is launching).
  if (!m.installed && m.installing) {
    return {
      kind: "install",
      progress: m.percent == null ? null : clampPercent(m.percent),
      installing: true,
    };
  }
  if (m.game.phase === "launching") return { kind: "starting" };
  if (m.room.gameState !== "open" || !m.room.lanPort || !m.room.relayShareCode) {
    return { kind: "waitHost" };
  }
  if (!m.installed) return { kind: "install", progress: null, installing: false };
  return { kind: "join" };
}

/** Host may change the party pack only while nothing is running for the party. */
export function canChangePartyPack(
  room: VoiceRoom,
  members: VoiceMember[],
  now: number = Date.now(),
): boolean {
  return (
    room.gameState === "idle" &&
    members.every((m) => {
      const state = effectiveMemberState(m, now);
      return state !== "in_game" && state !== "in_world";
    })
  );
}
