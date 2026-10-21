import { create } from "zustand";
import { netLog } from "@/shared/api/netLog";
import {
  decodeRelayShareCode,
  ensureRelayReady,
  looksLikeRelayKey,
  relayStopGameJoin,
} from "@/shared/api/relay";
import { MSG } from "@/shared/config/messages";
import { RAIL } from "@/shared/config/routes";
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

/** Open the tunnel to a friend's hosted world and launch into it. */
export async function joinFriendSession(row: FriendRow): Promise<void> {
  if (!canJoinFriend(row) || useJoiningFriend.getState().id) return;
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
        "Host lobby is not ready yet — ask them to Open to LAN again",
      );
    }

    const relayKey = decodeRelayShareCode(shareCode);
    if (relayKey == null && !looksLikeRelayKey(shareCode)) {
      throw new Error(
        "This host is on an old network session — ask them to update Remined and Open to LAN again",
      );
    }

    try {
      await ensureRelayReady();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
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
    const msg = err instanceof Error ? err.message : String(err);
    void netLog("ui", `Join FAILED: ${msg}`);
    void relayStopGameJoin().catch(() => undefined);
    setStatus(msg, "error");
    useGameStore.getState().setPhase("idle");
  } finally {
    useJoiningFriend.setState({ id: null });
  }
}
