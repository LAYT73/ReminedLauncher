import { useT } from "@/shared/i18n";
import { transitionTo } from "@/shared/lib/pageTransition";
import homeMcLogo from "@/shared/assets/home-mc-logo.png";
import { RAIL, routeFor } from "@/shared/config/routes";
import { isReminePackId } from "@/shared/lib/packIds";
import { EnchantParticles } from "@/shared/ui/EnchantParticles";
import {
  useActiveReminePack,
  usePackStore,
  useReminePacks,
  useViewCatalog,
} from "@/entities/pack";
import { committedUsername, useProfileStore } from "@/entities/profile";
import { SkinModel, useSkinStore } from "@/entities/skin";
import { useHomeVideoReady } from "@/widgets/home-video";

export function HomePage() {
  const t = useT();
  const videoReady = useHomeVideoReady((s) => s.ready);
  const profile = useProfileStore((s) => s.profile);
  const appVersion = useProfileStore((s) => s.appVersion);
  const skinPreview = useSkinStore((s) => s.preview);
  const capePreview = useSkinStore((s) => s.capePreview);
  const installedIds = usePackStore((s) => s.installedIds);
  const active = useActiveReminePack();
  const reminePacks = useReminePacks();
  const viewCatalog = useViewCatalog();

  const featurePack = active ?? reminePacks[0] ?? null;
  const featureContent = featurePack
    ? viewCatalog.find((c) => c.id === featurePack.id)
    : viewCatalog.find((c) => isReminePackId(c.id));
  const packReady = Boolean(featurePack && installedIds.has(featurePack.id));

  function openFeature(packId: string) {
    const { profile: current, persist } = useProfileStore.getState();
    void persist({ ...current, selected_pack: packId }).catch(() => undefined);
    transitionTo(routeFor(RAIL.java));
  }

  return (
    <div
      className={`home-stage has-video${videoReady ? " is-video-ready" : ""}`}
    >
      <div className="home-video-scrim" aria-hidden />
      <EnchantParticles className="pack-enchant" count={26} />
      <div className="home-splash">
        <img
          className="home-mc-logo"
          src={homeMcLogo}
          alt={t("pack.home.logoAlt")}
          draggable={false}
        />
      </div>
      <div className="home-body-row">
        <div className="home-main">
          <div className="home-bottom">
            {featurePack ? (
              <button
                type="button"
                className="home-feature"
                onClick={() => openFeature(featurePack.id)}
              >
                {featureContent?.logo_url ? (
                  <img
                    className="home-feature-logo"
                    src={featureContent.logo_url}
                    alt=""
                  />
                ) : (
                  <span className="home-feature-logo is-fallback" aria-hidden>
                    {(featurePack.name || "?").slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="home-feature-copy">
                  <strong>{featurePack.name}</strong>
                  <span>
                    {featureContent?.tagline?.trim() ||
                      featurePack.version ||
                      (packReady
                        ? t("pack.home.installed")
                        : t("pack.home.notInstalled"))}
                  </span>
                </span>
                <span className="home-feature-cta">
                  {packReady ? t("pack.home.open") : t("pack.home.view")}
                </span>
              </button>
            ) : null}
            <p className="home-foot">v{appVersion}</p>
          </div>
        </div>

        <div className="home-player">
          <SkinModel
            preset="home"
            skinUrl={skinPreview}
            capeUrl={capePreview}
            skinModel={profile.skin_model}
            variant="full"
            transparent
            nameTag={committedUsername(profile)}
            className="home-player-skin"
          />
        </div>
      </div>
    </div>
  );
}
