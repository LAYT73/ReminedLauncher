import { create } from "zustand";
import { portholeStartJoin, portholeStatus, portholeStopJoin } from "@/shared/api/porthole";
import { MSG } from "@/shared/config/messages";
import { TAB, routeFor, RAIL } from "@/shared/config/routes";
import { navigateTo } from "@/shared/lib/navigator";
import { toast } from "@/shared/lib/toast";
import { canJoinFriend, type FriendRow } from "@/entities/friend";
import { useGameStore } from "@/entities/game";
import { setStatus } from "@/entities/install";
import { launchWithOpts } from "./launch";

/** Friendship id currently being joined (disables the other Join buttons). */
export const useJoiningFriend = create<{ id: string | null }>(() => ({ id: null }));

/** Open the Porthole tunnel to a friend's hosted world and launch into it. */
export async function joinFriendSession(row: FriendRow): Promise<void> {
  if (!canJoinFriend(row) || useJoiningFriend.getState().id) return;
  const packId = row.sessionPackId!;
  const shareCode = row.sessionShareCode!.trim();
  const port = row.sessionGamePort!;
  useJoiningFriend.setState({ id: row.friendshipId });
  toast(MSG.launch.joining(row.profile.username));
  setStatus(MSG.launch.connectingNetwork);
  try {
    const st = await portholeStatus();
    if (!st.installed) {
      setStatus(st.message, "error");
      toast(MSG.launch.installPorthole);
      navigateTo(routeFor(RAIL.home, TAB.network));
      return;
    }
    await portholeStartJoin(shareCode, port);
    await launchWithOpts({ packId, quickPlay: `127.0.0.1:${port}` });
  } catch (err) {
    void portholeStopJoin().catch(() => undefined);
    setStatus(err instanceof Error ? err.message : String(err), "error");
    useGameStore.getState().setPhase("idle");
  } finally {
    useJoiningFriend.setState({ id: null });
  }
}
