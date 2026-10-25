import { create } from "zustand";
import { netLog } from "@/shared/api/netLog";
import { sendGameBridge } from "@/shared/api/gameBridge";
import {
  decodeRelayShareCode,
  ensureRelayReady,
  looksLikeRelayKey,
  relayStartGameJoin,
  relayStopGameJoin,
} from "@/shared/api/relay";
import { t } from "@/shared/i18n";
import { MSG } from "@/shared/config/messages";
import { RAIL } from "@/shared/config/routes";
import { errorMessage } from "@/shared/lib/errors";
import { useGameBridgeStore } from "@/shared/lib/gameBridgeStore";
import { navigateTo } from "@/shared/lib/navigator";
import { toast } from "@/shared/lib/toast";
import {
  canJoinFriend,
  fetchFriendHosting,
  type FriendRow,
} from "@/entities/friend";
import { useGameStore } from "@/entities/game";
import { setStatus } from "@/entities/install";
import { launchWithOpts } from "./launch";

/** Friendship id currently being joined (disables the other Join buttons). */
export const useJoiningFriend = create<{ id: string | null }>(() => ({
  id: null,
}));

export type HostWorld = {
  packId: string;
  /** Remined Relay share code of the host (rmd1_… or raw relay key). */
  shareCode: string;
  /** Host LAN / game port the tunnel forwards to. */
  port: number;
  /** Name shown in-game for the host (friend or party host). */
  hostName: string;
  /** Party paths keep the user on the Party tab after the launch. */
  stayOnPage?: boolean;
};

/**
 * Join a host's world: open the relay tunnel, then either connect the running
 * game through the in-game companion, or launch the pack straight into the world.
 * Throws on failure (callers own the UI state); never relaunches a running game.
 */
export async function joinHostWorld(world: HostWorld): Promise<boolean> {
  const { packId, shareCode, port, hostName, stayOnPage } = world;
  const relayKey = decodeRelayShareCode(shareCode);
  if (relayKey == null && !looksLikeRelayKey(shareCode)) {
    throw new Error(t("pack.launch.oldSession"));
  }
  const tunnelCode = relayKey ?? shareCode;

  if (useGameStore.getState().phase === "running") {
    if (!useGameBridgeStore.getState().connected) {
      toast(t("social.inGame.joinNeedsClose"), "err");
      return false;
    }
    if (packId !== useGameStore.getState().runningPackId) {
      toast(t("social.inGame.joinOtherPack"), "err");
      return false;
    }
    await ensureRelayReady();
    await relayStartGameJoin(tunnelCode, port);
    const sent = await sendGameBridge({
      t: "connect",
      host: "127.0.0.1",
      port,
      name: hostName,
    });
    if (!sent) throw new Error(t("social.inGame.joinNeedsClose"));
    void netLog("ui", `In-game join host=${hostName} port=${port}`);
    return true;
  }

  try {
    await ensureRelayReady();
  } catch (err) {
    const msg = errorMessage(err);
    void netLog("ui", `Join aborted: Relay not ready (${msg})`);
    setStatus(msg, "error");
    toast(MSG.voice.installRelay);
    navigateTo(`/${RAIL.settings}#network`);
    return false;
  }

  void netLog(
    "ui",
    `Join host=${hostName} pack=${packId} code=${shareCode} port=${port} tunnel=relay`,
  );
  const launched = await launchWithOpts({
    packId,
    quickPlay: `127.0.0.1:${port}`,
    relayJoin: { shareCode: tunnelCode, port },
    stayOnPage,
  });
  if (launched) void netLog("ui", `Join launch issued quickPlay=127.0.0.1:${port}`);
  return launched;
}

/** Join a friend's hosted world (friends list / in-game J key). */
export async function joinFriendSession(row: FriendRow): Promise<void> {
  if (!canJoinFriend(row) || useJoiningFriend.getState().id) return;
  const phase = useGameStore.getState().phase;
  if (phase === "launching") {
    toast(t("social.inGame.joinWhileLaunching"), "err");
    return;
  }
  useJoiningFriend.setState({ id: row.friendshipId });
  toast(MSG.launch.joining(row.profile.username));
  if (phase !== "running") setStatus(MSG.launch.connectingNetwork);
  try {
    // Friends list can lag a re-Open-to-LAN — pull live lobby:<id> + port.
    const live = await fetchFriendHosting(row.profile.id).catch(() => null);
    const packId = live?.packId || row.sessionPackId!;
    const shareCode = (live?.shareCode || row.sessionShareCode || "").trim();
    const port = live?.gamePort || row.sessionGamePort!;
    if (!shareCode || !port) {
      throw new Error(t("pack.launch.hostNotReady"));
    }
    await joinHostWorld({ packId, shareCode, port, hostName: row.profile.username });
  } catch (err) {
    const msg = errorMessage(err);
    void netLog("ui", `Join FAILED: ${msg}`);
    void relayStopGameJoin().catch(() => undefined);
    setStatus(msg, "error");
    if (useGameStore.getState().phase !== "running") {
      useGameStore.getState().setPhase("idle");
    }
  } finally {
    useJoiningFriend.setState({ id: null });
  }
}

/**
 * Party "Join" / "Install": same path as a friend join, for the room's host.
 * Resolves true when the join was issued, false after reporting the failure.
 */
export async function joinPartyWorld(world: HostWorld): Promise<boolean> {
  try {
    // A false return already told the player why (toast), so only thrown errors toast here.
    return await joinHostWorld({ ...world, stayOnPage: true });
  } catch (err) {
    const msg = errorMessage(err);
    void netLog("ui", `Party join FAILED: ${msg}`);
    void relayStopGameJoin().catch(() => undefined);
    setStatus(msg, "error");
    toast(t("voice.party.joinFailed", { reason: msg }), "err");
    if (useGameStore.getState().phase !== "running") {
      useGameStore.getState().setPhase("idle");
    }
    return false;
  }
}
