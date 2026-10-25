import { useEffect, useRef } from "react";
import { useGameStore } from "@/entities/game";
import {
  getRoomHostName,
  getVoiceRoom,
  inviteToParty,
  usePartyStore,
  type PartyCommand,
  type VoiceRoom,
} from "@/entities/voice-room";
import { sendGameNotify } from "@/shared/api/gameBridge";
import { currentPathname, navigateTo } from "@/shared/lib/navigator";
import { errorMessage } from "@/shared/lib/errors";
import { useGameBridgePrefs } from "@/shared/lib/gameBridgePrefs";
import { useGameBridgeStore } from "@/shared/lib/gameBridgeStore";
import { parseRoute, RAIL, routeFor, RAIL_TABS, TAB } from "@/shared/config/routes";
import { t } from "@/shared/i18n";
import { gameOnPartyPack } from "../lib/partyState";
import type { ToastFn } from "./types";

/** An in-game join waits this long for its room to show up before it is dropped. */
const AUTO_JOIN_TTL = 30_000;

/** What the command handler needs from the voice panel (latest values, read through a ref). */
export type PartyCommandDeps = {
  userId: string;
  active: VoiceRoom | null;
  isHost: boolean;
  busy: boolean;
  onToast: ToastFn;
  /** Create a party as host; resolves the new room id. */
  onCreate: () => Promise<string | null>;
  joinRoomById: (roomId: string) => Promise<void>;
  /** Host-only invite of a friend into the current party. */
  requestSwitch: (roomId: string) => void;
  /** Deep link into a party while in none: ask the player first. */
  requestJoinConfirm: (ask: { roomId: string; hostName: string }) => void;
  /** Party button of the current room (join / install / nothing). */
  primaryKind: string | null;
  onPrimary: () => Promise<void>;
};

/** Bring the voice tab forward, keeping the current rail when it has one. */
function focusVoiceTab(): void {
  const { rail, tab } = parseRoute(currentPathname());
  if (tab === TAB.voice) return;
  const keepRail = (RAIL_TABS[rail] ?? []).includes(TAB.voice);
  navigateTo(routeFor(keepRail ? rail : RAIL.home, TAB.voice));
}

async function startWithFriend(cmd: { friendId: string }, d: PartyCommandDeps): Promise<void> {
  if (d.active) {
    if (!d.isHost) {
      d.onToast(t("voice.party.leaveFirst"), "err");
      return;
    }
    if (!d.active.relayShareCode) {
      d.onToast(t("voice.toasts.waitLobbyCode"), "err");
      return;
    }
    await inviteToParty({ roomId: d.active.id, fromId: d.userId, toId: cmd.friendId }).catch(
      (err) => d.onToast(errorMessage(err, ""), "err"),
    );
    return;
  }
  const roomId = await d.onCreate();
  if (!roomId) return;
  await inviteToParty({ roomId, fromId: d.userId, toId: cmd.friendId }).catch((err) =>
    d.onToast(errorMessage(err, ""), "err"),
  );
}

/** Refuse a join: launcher toast, plus the in-game notice when the companion is connected. */
function refuseJoin(d: PartyCommandDeps, body: string): void {
  d.onToast(body, "err");
  if (useGameBridgeStore.getState().connected && useGameBridgePrefs.getState().notifications) {
    sendGameNotify({ kind: "info", title: t("voice.party.title"), body });
  }
}

async function joinParty(roomId: string, d: PartyCommandDeps, confirm: boolean): Promise<void> {
  focusVoiceTab();
  if (d.active?.id === roomId) {
    // Already in this party: a member's join key opens the host's world.
    if (!d.isHost && (d.primaryKind === "join" || d.primaryKind === "install")) {
      await d.onPrimary();
    }
    return;
  }
  // Refuse before entering voice when the game would block the world join anyway.
  const target = await getVoiceRoom(roomId).catch(() => null);
  if (!target || target.status !== "open") {
    refuseJoin(d, t("voice.party.closed"));
    return;
  }
  const game = useGameStore.getState();
  if (
    target.packId &&
    game.phase !== "idle" &&
    !gameOnPartyPack(
      {
        phase: game.phase,
        runningPackId: game.runningPackId,
        lastLaunchedPackId: game.lastLaunchedPackId,
        live: game.live,
        hostingLanPort: game.hostingLan?.gamePort ?? null,
      },
      target.packId,
    )
  ) {
    refuseJoin(d, t("voice.party.closeGameToJoin"));
    return;
  }
  if (d.active) {
    d.requestSwitch(roomId);
    return;
  }
  if (confirm) {
    const hostName = (await getRoomHostName(target.hostId).catch(() => null)) ?? t("voice.aFriend");
    d.requestJoinConfirm({ roomId, hostName });
    return;
  }
  await d.joinRoomById(roomId);
}

/**
 * Runs party requests (friends list "Start party", deep link, in-game key) in the
 * voice feature, which owns the live session. A request waits while the panel is busy.
 */
export function usePartyCommands(deps: PartyCommandDeps): void {
  const command = usePartyStore((s) => s.command);
  const latest = useRef(deps);
  latest.current = deps;
  /** In-game join: once the room is in, continue into the world when the host's world is open. */
  const autoJoin = useRef<{ roomId: string; at: number } | null>(null);

  useEffect(() => {
    if (!command) return;
    const d = latest.current;
    if (d.busy) return;
    usePartyStore.getState().takeCommand();
    if (command.kind === "join" && !command.confirm) {
      autoJoin.current = { roomId: command.roomId, at: Date.now() };
    }
    void run(command, d).catch((err) => d.onToast(errorMessage(err, ""), "err"));
    // `busy` re-runs the effect so a request made during a busy step is picked up afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, deps.busy]);

  // Joined via in-game J: the player asked for this world, so enter it right away when it is open.
  useEffect(() => {
    const want = autoJoin.current;
    if (!want) return;
    const d = latest.current;
    if (Date.now() - want.at > AUTO_JOIN_TTL) {
      autoJoin.current = null;
      return;
    }
    if (!d.active || d.active.id !== want.roomId) return;
    autoJoin.current = null;
    if (!d.isHost && d.primaryKind === "join") void d.onPrimary();
    // Re-checked when the room or its world state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.active?.id, deps.primaryKind]);
}

async function run(command: PartyCommand, d: PartyCommandDeps): Promise<void> {
  if (command.kind === "start") return startWithFriend(command, d);
  return joinParty(command.roomId, d, command.confirm === true);
}
