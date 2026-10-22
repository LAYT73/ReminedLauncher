import { useT } from "@/shared/i18n";
import { transitionTo } from "@/shared/lib/pageTransition";
import { MSG } from "@/shared/config/messages";
import { RAIL, routeFor } from "@/shared/config/routes";
import { toast } from "@/shared/lib/toast";
import { useRoute } from "@/shared/lib/useRoute";
import { PixelWifiOffIcon } from "@/shared/ui/PixelIcons";
import { tryReconnectFromOffline } from "@/features/auth";
import { copyReminedId } from "@/features/profile-edit";
import { committedUsername, useProfileStore } from "@/entities/profile";
import { useSessionStore } from "@/entities/session";
import { SkinHead, useSkinStore } from "@/entities/skin";

/** Avatar, nick and Remined id at the right of the top nav. */
export function ProfileChip() {
  const t = useT();
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
          title={t("shell.chip.offlineTitle")}
          aria-label={t("shell.chip.offlineAria")}
          onClick={() => {
            toast(MSG.offline.chipHint, "err");
            void tryReconnectFromOffline();
          }}
        >
          <PixelWifiOffIcon className="topnav-offline-icon" />
        </button>
      ) : null}
      <button
        type="button"
        className="topnav-avatar-btn"
        title={t("shell.chip.profile")}
        onClick={() => transitionTo(routeFor(RAIL.profile))}
      >
        <SkinHead skinUrl={skinPreview} className="topnav-avatar" size={36} />
      </button>
      <div className="topnav-identity">
        <strong className="topnav-nick">{committedUsername({ username })}</strong>
        {reminedId ? (
          <button
            type="button"
            className="topnav-id"
            title={t("profile.copyIdTitle")}
            onClick={() => void copyReminedId()}
          >
            #{reminedId}
          </button>
        ) : null}
      </div>
    </div>
  );
}
