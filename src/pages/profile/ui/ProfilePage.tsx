import { InfoNote } from "@/shared/ui/InfoNote";
import { PixelCheckIcon, PixelCrossIcon } from "@/shared/ui/PixelIcons";
import { MSG } from "@/shared/config/messages";
import { signOut } from "@/features/auth";
import {
  clearCape,
  clearSkin,
  copyReminedId,
  pickCape,
  pickSkin,
  setSkinModel,
  useUsernameEditor,
} from "@/features/profile-edit";
import { useProfileStore } from "@/entities/profile";
import { useSessionStore } from "@/entities/session";
import { SkinModel, useSkinStore } from "@/entities/skin";

export function ProfilePage() {
  const profile = useProfileStore((s) => s.profile);
  const email = useSessionStore((s) => s.session?.user?.email);
  const offlineMode = useSessionStore((s) => s.offlineMode);
  const reminedId = useSessionStore((s) => s.reminedId);
  const skinPreview = useSkinStore((s) => s.preview);
  const capePreview = useSkinStore((s) => s.capePreview);
  const username = useUsernameEditor();
  return (
    <section className="section">
      <h2 className="page-title">Profile</h2>
      {email ? (
        <p className="friends-lead">{email}</p>
      ) : offlineMode ? (
        <p className="friends-lead">Offline account</p>
      ) : (
        <p className="friends-lead">Your Remined account</p>
      )}
      {reminedId ? (
        <InfoNote id="profile.remined-id">
          <p>
            Your Remined id is{" "}
            <button
              type="button"
              className="friends-inline-link"
              title={MSG.profile.copyIdTitle}
              onClick={() => void copyReminedId()}
            >
              #{reminedId}
            </button>
            . Friends add you with this id.
          </p>
        </InfoNote>
      ) : null}

      <div className="skin-layout">
        <SkinModel
          skinUrl={skinPreview}
          capeUrl={capePreview}
          skinModel={profile.skin_model}
          variant="full"
          className="skin-stage"
        />
        <div className="skin-controls">
          <div className="field">
            <span className="field-label" id="skin-model-label">
              Arms
            </span>
            <div
              className="skin-model-toggle"
              role="group"
              aria-labelledby="skin-model-label"
            >
              <button
                type="button"
                className={`skin-model-btn${
                  profile.skin_model === "default" ? " is-active" : ""
                }`}
                aria-pressed={profile.skin_model === "default"}
                onClick={() => void setSkinModel("default")}
              >
                Wide
              </button>
              <button
                type="button"
                className={`skin-model-btn${
                  profile.skin_model === "slim" ? " is-active" : ""
                }`}
                aria-pressed={profile.skin_model === "slim"}
                onClick={() => void setSkinModel("slim")}
              >
                Slim
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="username">Username</label>
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
                    title="Save username"
                    disabled={username.busy}
                    onClick={username.commit}
                  >
                    <PixelCheckIcon />
                  </button>
                  <button
                    type="button"
                    className="btn-pixel-reset"
                    title="Discard"
                    disabled={username.busy}
                    onClick={username.reset}
                  >
                    <PixelCrossIcon color="#1a1a1a" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <p className="field-hint" style={{ marginBottom: 4 }}>
            Skin PNG — 64×64, 64×32 or 128×128, max 256 KB.
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn-mc ok"
              onClick={() => void pickSkin()}
            >
              Choose skin
            </button>
            {profile.skin_path ? (
              <button
                type="button"
                className="btn-mc danger"
                onClick={() => void clearSkin()}
              >
                Remove skin
              </button>
            ) : null}
          </div>
          <p className="field-hint" style={{ marginTop: 12, marginBottom: 4 }}>
            Cape PNG — usually 64×32, max 256 KB. 
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn-mc ok"
              onClick={() => void pickCape()}
            >
              Choose cape
            </button>
            {profile.cape_path ? (
              <button
                type="button"
                className="btn-mc danger"
                onClick={() => void clearCape()}
              >
                Remove cape
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="profile-account">
        {offlineMode ? (
          <p className="field-hint">
            {MSG.offline.accountNote}
          </p>
        ) : null}
        <button
          type="button"
          className="btn-mc danger btn-signout"
          onClick={() => void signOut()}
        >
          {offlineMode ? MSG.offline.leaveOffline : MSG.offline.signOut}
        </button>
      </div>
    </section>
  );
}
