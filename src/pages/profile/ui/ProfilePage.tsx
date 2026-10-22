import { MSG } from "@/shared/config/messages";
import { useT } from "@/shared/i18n";
import { PixelSignOutIcon } from "@/shared/ui/PixelIcons";
import { signOut } from "@/features/auth";
import { committedUsername, useProfileStore } from "@/entities/profile";
import { useSessionStore } from "@/entities/session";
import { useSkinStore } from "@/entities/skin";
import { ProfileHeader } from "./ProfileHeader";
import { ProfileStage } from "./ProfileStage";
import { CapeCard, SkinCard } from "./WardrobeCards";

export function ProfilePage() {
  const t = useT();
  const profile = useProfileStore((s) => s.profile);
  const email = useSessionStore((s) => s.session?.user?.email);
  const offlineMode = useSessionStore((s) => s.offlineMode);
  const reminedId = useSessionStore((s) => s.reminedId);
  const skinPreview = useSkinStore((s) => s.preview);
  const capePreview = useSkinStore((s) => s.capePreview);
  return (
    <section className="section">
      <div className="page-title-row profile-title-row">
        <h2 className="page-title">{t("profile.page.title")}</h2>
        <button
          type="button"
          className="btn-mc danger btn-icon-signout"
          title={offlineMode ? MSG.offline.leaveOffline : MSG.offline.signOut}
          aria-label={offlineMode ? MSG.offline.leaveOffline : MSG.offline.signOut}
          onClick={() => void signOut()}
        >
          <PixelSignOutIcon />
        </button>
      </div>

      <div className="profile-grid">
        <ProfileStage
          skinUrl={skinPreview}
          capeUrl={capePreview}
          skinModel={profile.skin_model}
          nameTag={committedUsername(profile)}
        />
        <div className="profile-main">
          <ProfileHeader
            email={email}
            offlineMode={offlineMode}
            reminedId={reminedId}
          />
          <h3 className="wardrobe-title">{t("profile.page.wardrobe")}</h3>
          <div className="wardrobe-grid">
            <SkinCard
              skinUrl={skinPreview}
              hasSkin={!!profile.skin_path}
              skinModel={profile.skin_model}
            />
            <CapeCard capeUrl={capePreview} hasCape={!!profile.cape_path} />
          </div>
        </div>
      </div>

      {offlineMode ? (
        <p className="field-hint profile-offline-note">{MSG.offline.accountNote}</p>
      ) : null}
    </section>
  );
}
