import { MSG } from "@/shared/config/messages";
import { signOut } from "@/features/auth";
import { copyReminedId } from "@/features/profile-edit";
import { useSessionStore } from "@/entities/session";

export function AccountSection() {
  const email = useSessionStore((s) => s.session?.user?.email);
  const reminedId = useSessionStore((s) => s.reminedId);
  const offlineMode = useSessionStore((s) => s.offlineMode);

  return (
    <div className="settings-block settings-account">
      <h3 className="settings-heading">Account</h3>
      {email ? (
        <p className="settings-account-email">{email}</p>
      ) : null}
      {reminedId ? (
        <p className="settings-account-id">
          Remined id{" "}
          <button
            type="button"
            className="topnav-id"
            onClick={() => void copyReminedId()}
          >
            #{reminedId}
          </button>
        </p>
      ) : null}
      {offlineMode ? (
        <p className="field-hint">{MSG.offline.accountNote}</p>
      ) : null}
      <button
        type="button"
        className="btn-mc danger btn-signout"
        onClick={() => void signOut()}
      >
        {offlineMode ? MSG.offline.leaveOffline : MSG.offline.signOut}
      </button>
    </div>
  );
}
