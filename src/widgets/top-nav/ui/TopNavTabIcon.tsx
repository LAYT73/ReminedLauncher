/** Icon (+ voice badge) for a top-nav tab. */
export function TopNavTabIcon({
  id,
  inRoom,
  inviteCount = 0,
}: {
  id: string;
  /** Show the "you're in a voice room" dot. */
  inRoom?: boolean;
  /** Pending invite count — takes priority over the in-room dot. */
  inviteCount?: number;
}) {
  if (id === "play") {
    return (
      <svg className="topnav-tab-icon" viewBox="0 0 24 24" aria-hidden>
        <path fill="currentColor" d="M8 5.14v13.72L19 12 8 5.14z" />
      </svg>
    );
  }
  if (id === "screenshots") {
    return (
      <svg className="topnav-tab-icon" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M4 6h3l1.5-2h7L17 6h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm8 3.2a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6z"
        />
      </svg>
    );
  }
  if (id === "friends") {
    return (
      <svg className="topnav-tab-icon" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm6.5-.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5zM3.5 19.25c0-2.9 2.35-5.25 5.5-5.25s5.5 2.35 5.5 5.25V20H3.5v-.75zm11.25-.75c0-1.55.48-2.98 1.28-4.16.72.28 1.5.44 2.32.44 2.76 0 5 2.01 5 4.5V20h-8.6v-.75z"
        />
      </svg>
    );
  }
  if (id === "network") {
    return (
      <svg className="topnav-tab-icon" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M12 4a8 8 0 0 1 8 8h-2a6 6 0 1 0-6 6v2a8 8 0 0 1 0-16zm0 4a4 4 0 0 1 4 4h-2a2 2 0 1 0-2 2v2a4 4 0 0 1 0-8zm-.75 7.25a1.25 1.25 0 1 1 1.5 0V20h-1.5v-4.75z"
        />
      </svg>
    );
  }
  if (id === "voice") {
    return (
      <>
        <svg className="topnav-tab-icon" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0z"
          />
        </svg>
        {inviteCount > 0 ? (
          <span className="topnav-tab-count" aria-label={`${inviteCount} pending invites`}>
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
