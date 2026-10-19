import { useNavigate } from "react-router";
import { MSG } from "@/shared/config/messages";
import { RAIL, routeFor } from "@/shared/config/routes";
import { toast } from "@/shared/lib/toast";
import { useRoute } from "@/shared/lib/useRoute";
import { tryReconnectFromOffline } from "@/features/auth";
import { copyReminedId } from "@/features/profile-edit";
import { committedUsername, useProfileStore } from "@/entities/profile";
import { useSessionStore } from "@/entities/session";
import { SkinHead, useSkinStore } from "@/entities/skin";

function OfflineIcon() {
  return (
    <svg
      className="topnav-offline-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="square"
        d="M2 8.5c3.2-3 7-4.5 10-4.5s6.8 1.5 10 4.5"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="square"
        d="M5.5 12.2c2.2-2 5-3 6.5-3s4.3 1 6.5 3"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="square"
        d="M9 15.8c.9-.8 2-1.2 3-1.2s2.1.4 3 1.2"
      />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" />
      <path
        className="topnav-offline-slash-outline"
        fill="none"
        strokeWidth="7.5"
        strokeLinecap="square"
        d="M4 20 L20 4"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="square"
        d="M4 20 L20 4"
      />
    </svg>
  );
}

/** Avatar, nick and Remined id at the right of the top nav. */
export function ProfileChip() {
  const navigate = useNavigate();
  const { rail } = useRoute();
  const offlineMode = useSessionStore((s) => s.offlineMode);
  const reminedId = useSessionStore((s) => s.reminedId);
  const skinPreview = useSkinStore((s) => s.preview);
  const username = useProfileStore((s) => s.profile.username);

  return (
    <div className={`topnav-profile ${rail === RAIL.profile ? "is-active" : ""}`}>
      {offlineMode ? (
        <button
          type="button"
          className="topnav-offline-btn"
          title="Offline — click to check connection"
          aria-label="Offline mode — check connection"
          onClick={() => {
            toast(MSG.offline.chipHint, "err");
            void tryReconnectFromOffline();
          }}
        >
          <OfflineIcon />
        </button>
      ) : null}
      <button
        type="button"
        className="topnav-avatar-btn"
        title="Profile"
        onClick={() => navigate(routeFor(RAIL.profile))}
      >
        <SkinHead skinUrl={skinPreview} className="topnav-avatar" size={36} />
      </button>
      <div className="topnav-identity">
        <strong className="topnav-nick">{committedUsername({ username })}</strong>
        {reminedId ? (
          <button
            type="button"
            className="topnav-id"
            title={MSG.profile.copyIdTitle}
            onClick={() => void copyReminedId()}
          >
            #{reminedId}
          </button>
        ) : null}
      </div>
    </div>
  );
}
