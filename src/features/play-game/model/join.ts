import { create } from "zustand";
import { netLog } from "@/shared/api/netLog";
import { portholeStatus, portholeStopGameJoin } from "@/shared/api/porthole";
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
export const useJoiningFriend = create<{ id: string | null }>(() => ({ id: null }));

/** Open the Porthole tunnel to a friend's hosted world and launch into it. */
export async function joinFriendSession(row: FriendRow): Promise<void> {
  if (!canJoinFriend(row) || useJoiningFriend.getState().id) return;
  useJoiningFriend.setState({ id: row.friendshipId });
  toast(MSG.launch.joining(row.profile.username));
  setStatus(MSG.launch.connectingNetwork);
  try {
    const st = await portholeStatus();
    if (!st.installed) {
      void netLog("ui", `Join aborted: Porthole not installed (${st.message})`);
      setStatus(st.message, "error");
      toast(MSG.launch.installPorthole);
      navigateTo(`/${RAIL.settings}#network`);
      return;
    }
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
    void netLog(
      "ui",
      `Join friend=${row.profile.username} pack=${packId} code=${shareCode} port=${port}${live ? " (fresh)" : " (cached)"}`,
    );
    // Prepare pack first; open the Steam tunnel only right before MC starts.
    await launchWithOpts({
      packId,
      quickPlay: `127.0.0.1:${port}`,
      portholeJoin: { shareCode, port },
    });
    void netLog("ui", `Join launch issued quickPlay=127.0.0.1:${port}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void netLog("ui", `Join FAILED: ${msg}`);
    void portholeStopGameJoin().catch(() => undefined);
    setStatus(msg, "error");
    useGameStore.getState().setPhase("idle");
  } finally {
    useJoiningFriend.setState({ id: null });
  }
}
