import { transitionTo } from "@/shared/lib/pageTransition";
import { useT } from "@/shared/i18n";
import { MSG } from "@/shared/config/messages";
import { RAIL } from "@/shared/config/routes";
import { toast } from "@/shared/lib/toast";
import { NoticePage } from "@/shared/ui/Notice";
import { FriendsPanel } from "@/features/friends";
import { joinFriendSession, useJoiningFriend } from "@/features/play-game";
import { useGameStore } from "@/entities/game";
import { selectUserId, useSessionStore } from "@/entities/session";

export function FriendsPage() {
  const t = useT();
  const userId = useSessionStore(selectUserId);
  const offlineMode = useSessionStore((s) => s.offlineMode);
  const reminedId = useSessionStore((s) => s.reminedId);
  const joiningFriendId = useJoiningFriend((s) => s.id);
  const hostingSelf = useGameStore((s) => Boolean(s.hostingLan));

  if (offlineMode || !userId) {
    return (
      <NoticePage
        title={t("social.friends.title")}
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
      onOpenNetworkPlay={() => transitionTo(`/${RAIL.settings}#network`)}
      onJoinFriend={(row) => void joinFriendSession(row)}
    />
  );
}
