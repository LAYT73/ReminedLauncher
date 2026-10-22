import { useT } from "@/shared/i18n";
import {
  PixelCameraIcon,
  PixelFriendsIcon,
  PixelMicIcon,
  PixelPlayIcon,
  PixelWifiIcon,
} from "@/shared/ui/PixelIcons";

/** Icon (+ voice badge) for a top-nav tab. */
export function TopNavTabIcon({
  id,
  inRoom,
  inviteCount = 0,
  friendIncoming = 0,
  friendOnline = 0,
}: {
  id: string;
  /** Show the "you're in a voice room" dot. */
  inRoom?: boolean;
  /** Pending invite count — takes priority over the in-room dot. */
  inviteCount?: number;
  /** Friends tab: pending incoming requests (yellow, priority). */
  friendIncoming?: number;
  /** Friends tab: friends online (green). */
  friendOnline?: number;
}) {
  const t = useT();
  if (id === "play") return <PixelPlayIcon className="topnav-tab-icon" />;
  if (id === "screenshots") return <PixelCameraIcon className="topnav-tab-icon" />;
  if (id === "friends") {
    const incoming = friendIncoming > 0;
    const count = incoming ? friendIncoming : friendOnline;
    return (
      <>
        <PixelFriendsIcon className="topnav-tab-icon" />
        {count > 0 ? (
          <span
            className={`topnav-tab-count ${incoming ? "" : "is-online"}`}
            aria-label={t(
              incoming ? "shell.nav.friendRequests" : "shell.nav.friendsOnline",
              { count },
            )}
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </>
    );
  }
  if (id === "network") return <PixelWifiIcon className="topnav-tab-icon" />;
  if (id === "voice") {
    return (
      <>
        <PixelMicIcon className="topnav-tab-icon" />
        {inviteCount > 0 ? (
          <span className="topnav-tab-count" aria-label={t("shell.nav.pendingInvites", { count: inviteCount })}>
            {inviteCount > 9 ? "9+" : inviteCount}
          </span>
        ) : inRoom ? (
          <span className="topnav-tab-badge" />
        ) : null}
      </>
    );
  }
  return null;
}
