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

/**
 * Join a friend's hosted world while Minecraft is already running: open the
 * tunnel, then tell the in-game companion to connect. Never relaunches the game.
 */
async function joinWhileRunning(row: FriendRow): Promise<void> {
  if (!useGameBridgeStore.getState().connected) {
    toast(t("social.inGame.joinNeedsClose"), "err");
    return;
  }
  useJoiningFriend.setState({ id: row.friendshipId });
  toast(MSG.launch.joining(row.profile.username));
  try {
    const live = await fetchFriendHosting(row.profile.id).catch(() => null);
    const packId = live?.packId || row.sessionPackId!;
    if (packId !== useGameStore.getState().runningPackId) {
      toast(t("social.inGame.joinOtherPack"), "err");
      return;
    }
    const shareCode = (live?.shareCode || row.sessionShareCode || "").trim();
    const port = live?.gamePort || row.sessionGamePort!;
    if (!shareCode || !port) {
      throw new Error(t("pack.launch.hostNotReady"));
    }
    const relayKey = decodeRelayShareCode(shareCode);
    if (relayKey == null && !looksLikeRelayKey(shareCode)) {
      throw new Error(t("pack.launch.oldSession"));
    }
    await ensureRelayReady();
    await relayStartGameJoin(relayKey ?? shareCode, port);
    const sent = await sendGameBridge({
      t: "connect",
      host: "127.0.0.1",
      port,
      name: row.profile.username,
    });
    if (!sent) throw new Error(t("social.inGame.joinNeedsClose"));
    void netLog("ui", `In-game join friend=${row.profile.username} port=${port}`);
  } catch (err) {
    const msg = errorMessage(err);
    void netLog("ui", `In-game join FAILED: ${msg}`);
    void relayStopGameJoin().catch(() => undefined);
    setStatus(msg, "error");
  } finally {
    useJoiningFriend.setState({ id: null });
  }
}

/** Open the tunnel to a friend's hosted world and launch into it. */
export async function joinFriendSession(row: FriendRow): Promise<void> {
  if (!canJoinFriend(row) || useJoiningFriend.getState().id) return;
  const phase = useGameStore.getState().phase;
  if (phase === "launching") {
    toast(t("social.inGame.joinWhileLaunching"), "err");
    return;
  }
  if (phase === "running") {
    await joinWhileRunning(row);
    return;
  }
  useJoiningFriend.setState({ id: row.friendshipId });
  toast(MSG.launch.joining(row.profile.username));
  setStatus(MSG.launch.connectingNetwork);
  try {
    // Friends list can lag a re-Open-to-LAN — pull live lobby:<id> + port.
    const live = await fetchFriendHosting(row.profile.id).catch(() => null);
    const packId = live?.packId || row.sessionPackId!;
    const shareCode = (live?.shareCode || row.sessionShareCode || "").trim();
    const port = live?.gamePort || row.sessionGamePort!;
    if (!shareCode || !port) {
      throw new Error(
        t("pack.launch.hostNotReady"),
      );
    }

    const relayKey = decodeRelayShareCode(shareCode);
    if (relayKey == null && !looksLikeRelayKey(shareCode)) {
      throw new Error(
        t("pack.launch.oldSession"),
      );
    }

    try {
      await ensureRelayReady();
    } catch (err) {
      const msg = errorMessage(err);
      void netLog("ui", `Join aborted: Relay not ready (${msg})`);
      setStatus(msg, "error");
      toast(MSG.voice.installRelay);
      navigateTo(`/${RAIL.settings}#network`);
      return;
    }

    const tunnelCode = relayKey ?? shareCode;
    void netLog(
      "ui",
      `Join friend=${row.profile.username} pack=${packId} code=${shareCode} port=${port} tunnel=relay${live ? " (fresh)" : " (cached)"}`,
    );
    await launchWithOpts({
      packId,
      quickPlay: `127.0.0.1:${port}`,
      relayJoin: { shareCode: tunnelCode, port },
    });
    void netLog("ui", `Join launch issued quickPlay=127.0.0.1:${port}`);
  } catch (err) {
    const msg = errorMessage(err);
    void netLog("ui", `Join FAILED: ${msg}`);
    void relayStopGameJoin().catch(() => undefined);
    setStatus(msg, "error");
    useGameStore.getState().setPhase("idle");
  } finally {
    useJoiningFriend.setState({ id: null });
  }
}
