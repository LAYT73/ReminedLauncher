import { useNavigate } from "react-router";
import { openPortholeOnSteam } from "@/shared/api/porthole";
import { MSG } from "@/shared/config/messages";
import { RAIL } from "@/shared/config/routes";
import { toast } from "@/shared/lib/toast";
import { NoticePage } from "@/shared/ui/Notice";
import { FriendsPanel } from "@/features/friends";
import { joinFriendSession, useJoiningFriend } from "@/features/play-game";
import { useGameStore } from "@/entities/game";
import { selectUserId, useSessionStore } from "@/entities/session";

export function FriendsPage() {
  const navigate = useNavigate();
  const userId = useSessionStore(selectUserId);
  const offlineMode = useSessionStore((s) => s.offlineMode);
  const reminedId = useSessionStore((s) => s.reminedId);
  const joiningFriendId = useJoiningFriend((s) => s.id);
  const hostingSelf = useGameStore((s) => Boolean(s.hostingLan));

  if (offlineMode || !userId) {
    return (
      <NoticePage
        title="Friends"
        text={offlineMode ? MSG.offline.friends : MSG.offline.friendsSignedOut}
      />
    );
  }
  return (
    <FriendsPanel
      userId={userId}
      myReminedId={reminedId}
      onToast={toast}
      joiningFriendId={joiningFriendId}
      hostingSelf={hostingSelf}
      onOpenNetworkPlay={() => navigate(`/${RAIL.settings}#network`)}
      onInstallPorthole={() => {
        void openPortholeOnSteam().then(() => toast(MSG.friends.openingSteam));
      }}
      onJoinFriend={(row) => void joinFriendSession(row)}
    />
  );
}
