import { useT } from "@/shared/i18n";
import {
  PixelCheckIcon,
  PixelCopyIcon,
  PixelCrossIcon,
} from "@/shared/ui/PixelIcons";
import { copyReminedId, useUsernameEditor } from "@/features/profile-edit";
import { committedUsername, useProfileStore } from "@/entities/profile";

type Props = {
  email: string | undefined;
  offlineMode: boolean;
  reminedId: string | number | null | undefined;
};

export function ProfileHeader({ email, offlineMode, reminedId }: Props) {
  const t = useT();
  const username = useUsernameEditor();
  const savedName = useProfileStore((s) => committedUsername(s.profile));
  const sub = email
    ? email
    : offlineMode
      ? t("profile.header.offlineAccount")
      : t("profile.header.yourAccount");
  return (
    <header className="profile-head">
      <div className="profile-head-top">
        <div className="profile-name">{savedName || t("profile.header.player")}</div>
        {reminedId ? (
          <div className="profile-id" title={t("profile.header.idHint")}>
            <span className="profile-id-chip">#{reminedId}</span>
            <button
              type="button"
              className="profile-id-copy"
              aria-label={t("profile.copyIdTitle")}
              title={t("profile.copyIdTitle")}
              onClick={() => void copyReminedId()}
            >
              <PixelCopyIcon />
            </button>
          </div>
        ) : null}
      </div>
      <p className="profile-sub">{sub}</p>
      <div className="field profile-username-field">
        <label htmlFor="username">{t("profile.header.username")}</label>
        <div className="username-edit">
          <input
            id="username"
            maxLength={16}
            spellCheck={false}
            value={username.value}
            onChange={(e) => username.onChange(e.target.value)}
            onFocus={username.onFocus}
          />
          {username.dirty ? (
            <div className="username-draft-actions">
              <button
                type="button"
                className="btn-pixel-check"
                title={t("profile.header.saveUsername")}
                aria-label={t("profile.header.saveUsername")}
                disabled={username.busy}
                onClick={username.commit}
              >
                <PixelCheckIcon />
              </button>
              <button
                type="button"
                className="btn-pixel-reset"
                title={t("profile.header.discard")}
                aria-label={t("profile.header.discardChanges")}
                disabled={username.busy}
                onClick={username.reset}
              >
                <PixelCrossIcon color="currentColor" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
